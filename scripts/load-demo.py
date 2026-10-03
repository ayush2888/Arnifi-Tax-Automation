"""Load a few synthetic statements into the local demo database."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker" / "src"))

import psycopg

from daftar.pipeline import confirm_mapping, connect, process_statement, register_upload
from daftar.settings import load_settings
from daftar.storage import ObjectStore

OMAR = "55555555-5555-4555-8555-555555555555"
AL_NOOR = "22222222-2222-4222-8222-222222222222"
NORTHWIND = "77777777-7777-4777-8777-777777777777"
SAMPLES = [
    "statement_utf8.csv",
    "statement_arabic.csv",
    "statement_broken.csv",
    "statement_text.pdf",
]


def main() -> None:
    env = {**dict(**{k: v for k, v in __import__("os").environ.items()}), "PGPASSWORD": "daftar-local-only"}
    subprocess.check_call(
        ["psql", "-h", "127.0.0.1", "-U", "daftar", "-d", "postgres", "-c", "SELECT 1 FROM pg_database WHERE datname = 'daftar'"],
        env=env,
    )
    probe = subprocess.check_output(
        ["psql", "-h", "127.0.0.1", "-U", "daftar", "-d", "daftar", "-tAc", "SELECT to_regclass('public.firms')"],
        env=env,
        text=True,
    ).strip()
    if probe != "firms":
        for name in (
            "01-schema.sql",
            "02-seed.sql",
            "03-profile-key.sql",
            "04-ledger.sql",
            "05-ledger-seed.sql",
            "06-release-packs.sql",
            "07-recon.sql",
            "08-close.sql",
            "09-close-seed.sql",
            "10-statements.sql",
            "11-ct.sql",
        ):
            subprocess.check_call(
                ["psql", "-h", "127.0.0.1", "-U", "daftar", "-d", "daftar", "-v", "ON_ERROR_STOP=1", "-f", str(ROOT / "db" / name)],
                env=env,
            )
    subprocess.check_call([str(ROOT / ".venv" / "bin" / "python"), str(ROOT / "fixtures" / "generate.py")])
    from daftar.bootstrap import bootstrap

    bootstrap()
    settings = load_settings()
    storage = ObjectStore(settings)
    folder = ROOT / "fixtures" / "generated"
    with connect(settings.database_url, OMAR) as conn:
        first_id = None
        for name in SAMPLES:
            content = (folder / name).read_bytes()
            result = register_upload(
                conn,
                storage,
                client_id=AL_NOOR,
                bank_account_id=NORTHWIND,
                uploaded_by=OMAR,
                filename=name,
                content=content,
                enqueue=False,
            )
            if result.get("duplicate"):
                print(f"duplicate {name} {result['statementId']}")
                continue
            statement_id = result["statementId"]
            process_statement(conn, storage, statement_id)
            if first_id is None:
                first_id = statement_id
                row = conn.execute("SELECT proposed_mapping, status FROM statements WHERE id = %s", (statement_id,)).fetchone()
                if row["status"] == "needs_review" and row["proposed_mapping"]:
                    proposal = row["proposed_mapping"]
                    confirm_mapping(
                        conn,
                        statement_id,
                        OMAR,
                        {
                            "columnMap": proposal["columnMap"],
                            "dateFormat": proposal["dateFormat"],
                            "decimalSeparator": proposal["decimalSeparator"],
                            "thousandsSeparator": proposal["thousandsSeparator"],
                        },
                    )
            print(name, statement_id)
    with psycopg.connect(settings.database_url_super) as conn:
        count = conn.execute("SELECT count(*) FROM bank_transactions").fetchone()[0]
    print(f"transactions {count}")


if __name__ == "__main__":
    main()
