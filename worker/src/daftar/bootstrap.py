"""Idempotent local setup: bucket plus encrypted synthetic IBANs."""

from __future__ import annotations

import psycopg

from daftar.crypto import encrypt_iban
from daftar.settings import load_settings
from daftar.storage import ObjectStore

# Obviously fake UAE-shaped numbers used only to prove encryption of seed accounts.
SYNTHETIC_IBANS = {
    "77777777-7777-4777-8777-777777777777": "AE070000000000000000001",
    "99999999-9999-4999-8999-999999999999": "AE070000000000000000003",
    "88888888-8888-4888-8888-888888888888": "AE070000000000000000002",
}


def bootstrap() -> None:
    settings = load_settings()
    ObjectStore(settings).ensure_bucket()
    with psycopg.connect(settings.database_url_super) as conn:
        for account_id, plain in SYNTHETIC_IBANS.items():
            row = conn.execute(
                "SELECT iban_encrypted FROM bank_accounts WHERE id = %s",
                (account_id,),
            ).fetchone()
            if row and row[0] is None:
                conn.execute(
                    "UPDATE bank_accounts SET iban_encrypted = %s WHERE id = %s",
                    (encrypt_iban(plain, settings.iban_key), account_id),
                )
        conn.commit()


if __name__ == "__main__":
    bootstrap()
