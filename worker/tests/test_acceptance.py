"""Phase 1 acceptance checks. These talk to Postgres, MinIO, and local OCR."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from daftar.crypto import decrypt_iban, encrypt_iban
from daftar.money import decimal_string_from_excel, parse_amount
from daftar.pipeline import confirm_mapping, process_statement, register_upload
from daftar.settings import load_settings
from tests.conftest import AL_NOOR, HARBOUR, NINA, NORTHWIND, OASIS, OMAR, ROOT

FIXTURES = ROOT / "fixtures" / "generated"


def test_money_rejects_floats_and_keeps_minor_units():
    with pytest.raises(TypeError):
        parse_amount(10.5)
    with pytest.raises(TypeError):
        parse_amount(10)
    assert parse_amount("10.50") == 1050
    assert parse_amount("1,234.56") == 123456
    assert parse_amount("1.234,56", decimal_sep=",", thousands_sep=".") == 123456
    assert parse_amount("") is None
    assert decimal_string_from_excel(250.0) == "250.00"
    with pytest.raises(Exception):
        decimal_string_from_excel(0.333333333333)


def test_minor_unit_columns_are_bigint():
    settings = load_settings()
    import psycopg

    with psycopg.connect(settings.database_url_super) as conn:
        rows = conn.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'bank_transactions'
              AND column_name IN ('debit_minor', 'credit_minor', 'balance_minor')
            """
        ).fetchall()
    assert {row[0]: row[1] for row in rows} == {
        "debit_minor": "bigint",
        "credit_minor": "bigint",
        "balance_minor": "bigint",
    }


def test_iban_ciphertext_hides_the_number():
    settings = load_settings()
    plain = "AE070000000000000000001"
    blob = encrypt_iban(plain, settings.iban_key)
    assert plain.encode() not in blob
    assert decrypt_iban(blob, settings.iban_key) == plain
    import psycopg

    with psycopg.connect(settings.database_url_super) as conn:
        stored = conn.execute(
            "SELECT iban_encrypted, iban_masked FROM bank_accounts WHERE id = %s",
            (NORTHWIND,),
        ).fetchone()
    assert stored[0] is not None
    assert plain.encode() not in bytes(stored[0])
    assert stored[1] == "AE** **** **** 0001"


def test_csv_xlsx_amounts_and_arabic_round_trip(ctx):
    conn, storage = ctx
    for name in ("statement_utf8.csv", "statement_arabic.csv", "statement_title.xlsx", "statement_legacy.xls"):
        statement_id = _ingest(conn, storage, name)
        _assert_amounts(conn, statement_id, _expected(name))


def test_text_pdf_does_not_use_ocr_and_scanned_pdf_does(ctx):
    conn, storage = ctx
    text_id = _ingest(conn, storage, "statement_text.pdf")
    _assert_amounts(conn, text_id, _expected("statement_text.pdf"))
    assert "ocr" not in _methods(conn, text_id)
    assert "pdf_text" in _methods(conn, text_id)
    ocr_events = conn.execute(
        """
        SELECT count(*) AS n FROM processing_events
        WHERE statement_id = %s AND (stage = 'ocr' OR method = 'ocr')
        """,
        (text_id,),
    ).fetchone()["n"]
    assert ocr_events == 0

    scanned_id = _ingest(conn, storage, "statement_scanned.pdf")
    _assert_amounts(conn, scanned_id, _expected("statement_scanned.pdf"), descriptions=True)
    assert "ocr" in _methods(conn, scanned_id)
    assert "pdf_text" not in _methods(conn, scanned_id)

    photo_id = _ingest(conn, storage, "statement_photo.png")
    _assert_amounts(conn, photo_id, _expected("statement_photo.png"), descriptions=True)
    assert "ocr" in _methods(conn, photo_id)


def test_broken_running_balance_flags_exact_rows(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_broken.csv")
    rows = _rows(conn, statement_id)
    flagged = {row["row_no"] for row in rows if "balance_break" in row["flags"]}
    assert flagged == {3, 4}
    for row in rows:
        if row["row_no"] in flagged:
            assert row["flags"] == ["balance_break"]
            assert row["review_status"] == "needs_review"
        else:
            assert "balance_break" not in row["flags"]


def test_xlsx_fixture_matches_expected_amounts(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_title.xlsx")
    _assert_amounts(conn, statement_id, _expected("statement_title.xlsx"))
    assert _statement(conn, statement_id)["extraction_method"] == "xlsx"


def test_image_fixture_matches_expected_amounts(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_photo.png")
    _assert_amounts(conn, statement_id, _expected("statement_photo.png"), descriptions=True)
    assert "ocr" in _methods(conn, statement_id)


def test_text_pdf_produces_zero_ocr_events(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_text.pdf")
    _assert_amounts(conn, statement_id, _expected("statement_text.pdf"))
    ocr_events = conn.execute(
        """
        SELECT count(*) AS n FROM processing_events
        WHERE statement_id = %s AND (stage = 'ocr' OR method = 'ocr')
        """,
        (statement_id,),
    ).fetchone()["n"]
    assert ocr_events == 0
    assert _statement(conn, statement_id)["extraction_method"] == "pdf_text"


def test_wrong_closing_balance_needs_review(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_wrong_closing.csv")
    statement = _statement(conn, statement_id)
    assert statement["status"] == "needs_review"
    assert "closing_mismatch" in statement["validation_flags"]
    assert all("balance_break" not in row["flags"] for row in _rows(conn, statement_id))


def test_reupload_creates_no_new_processing_events(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_utf8.csv")
    before = _event_count(conn)
    content = (FIXTURES / "statement_utf8.csv").read_bytes()
    again = register_upload(
        conn,
        storage,
        client_id=AL_NOOR,
        bank_account_id=NORTHWIND,
        uploaded_by=OMAR,
        filename="statement_utf8.csv",
        content=content,
    )
    assert again["duplicate"] is True
    assert again["statementId"] == statement_id
    assert _event_count(conn) == before
    count = conn.execute("SELECT count(*) AS n FROM files WHERE client_id = %s", (AL_NOOR,)).fetchone()["n"]
    assert count == 1


def test_overlapping_statements_flag_duplicates_without_deleting(ctx):
    conn, storage = ctx
    _ingest(conn, storage, "statement_overlap_a.csv")
    _ingest(conn, storage, "statement_overlap_b.csv")
    rows = conn.execute(
        "SELECT description_raw, flags FROM bank_transactions WHERE client_id = %s",
        (AL_NOOR,),
    ).fetchall()
    assert len(rows) == 8
    duplicates = [row for row in rows if "duplicate" in row["flags"]]
    assert len(duplicates) == 4
    assert {row["description_raw"] for row in duplicates} == {"OFFICE SUPPLIES", "SALARY TRANSFER"}


def test_confirmed_mapping_is_reused(ctx):
    conn, storage = ctx
    first = _ingest(conn, storage, "statement_odd.csv", account_id=OASIS, confirm=True)
    _assert_amounts(conn, first, _expected("statement_odd.csv"))
    profiles = conn.execute(
        "SELECT count(*) AS n FROM parser_profiles WHERE bank_name = 'Oasis Mutual Bank'"
    ).fetchone()["n"]
    assert profiles == 1
    second = _ingest(conn, storage, "statement_odd_feb.csv", account_id=OASIS, confirm=False)
    statement = _statement(conn, second)
    assert statement["error"] is None
    assert statement["status"] == "parsed"
    assert len(_rows(conn, second)) == 2
    profiles_after = conn.execute(
        "SELECT count(*) AS n FROM parser_profiles WHERE bank_name = 'Oasis Mutual Bank'"
    ).fetchone()["n"]
    assert profiles_after == 1


def test_password_is_not_stored_and_unlocks_the_pdf(ctx, caplog):
    conn, storage = ctx
    caplog.set_level(logging.INFO)
    waiting = _ingest(conn, storage, "statement_locked.pdf", confirm=False, password=None)
    assert _statement(conn, waiting)["error"] == "password_required"
    assert _rows(conn, waiting) == []
    opened = _ingest(conn, storage, "statement_locked.pdf", confirm=True, password="synthetic")
    # Same bytes: the second call is a duplicate of the encrypted file, so unlock the original.
    if opened == waiting:
        process_statement(conn, storage, waiting, "synthetic")
        if _statement(conn, waiting)["error"] == "mapping_unconfirmed":
            _confirm(conn, waiting)
        opened = waiting
    _assert_amounts(conn, opened, _expected("statement_locked.pdf"))
    import psycopg

    settings = load_settings()
    with psycopg.connect(settings.database_url_super) as admin:
        texts = admin.execute(
            """
            SELECT COALESCE(error, '') FROM statements
            UNION ALL
            SELECT COALESCE(payload::text, '') FROM jobs
            UNION ALL
            SELECT stage || ' ' || method FROM processing_events
            """
        ).fetchall()
        jobs = admin.execute("SELECT COALESCE(payload::text, '') FROM jobs").fetchall()
    assert all("synthetic" not in row[0] for row in texts)
    assert all("synthetic" not in row[0] and "password" not in row[0] for row in jobs)
    assert "synthetic" not in caplog.text
    assert all("synthetic" not in record.getMessage() for record in caplog.records)


def test_every_transaction_has_a_source_box(ctx):
    conn, storage = ctx
    statement_id = _ingest(conn, storage, "statement_utf8.csv")
    rows = _rows(conn, statement_id)
    assert rows
    for row in rows:
        assert row["source_page"] == 1
        assert row["source_bbox"]["width"] > 0
        assert row["source_bbox"]["pageWidth"] > 0
    page = conn.execute(
        "SELECT storage_key, width, height FROM statement_pages WHERE statement_id = %s",
        (statement_id,),
    ).fetchone()
    assert page["width"] == rows[0]["source_bbox"]["pageWidth"]
    assert page["height"] == rows[0]["source_bbox"]["pageHeight"]


def test_row_level_security_hides_other_clients(ctx):
    conn, storage = ctx
    _ingest(conn, storage, "statement_utf8.csv")
    import psycopg

    from daftar.pipeline import connect

    settings = load_settings()
    with connect(settings.database_url, NINA) as nina:
        assert nina.execute("SELECT current_user AS role").fetchone()["role"] == "daftar_app"
        hidden = nina.execute("SELECT count(*) AS n FROM bank_transactions").fetchone()["n"]
        assert hidden == 0
        clients = {str(row["id"]) for row in nina.execute("SELECT id FROM clients").fetchall()}
        assert clients == {HARBOUR}
    with connect(settings.database_url, OMAR) as omar:
        visible = omar.execute("SELECT count(*) AS n FROM bank_transactions").fetchone()["n"]
        assert visible == 6
        with pytest.raises(psycopg.Error):
            omar.execute(
                """
                INSERT INTO files (client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
                VALUES (%s, 'cross-client', 'x.csv', 'text/csv', 1, 'hidden', %s)
                """,
                (HARBOUR, OMAR),
            )
            omar.commit()


def test_forced_rls_and_set_local_is_transaction_scoped(ctx):
    import psycopg
    from psycopg.rows import dict_row

    conn, _storage = ctx
    settings = load_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as raw:
        assert raw.execute("SELECT current_user AS role").fetchone()["role"] == "daftar_app"
        raw.execute("BEGIN")
        raw.execute("SELECT set_config('app.current_user_id', %s, true)", (OMAR,))
        assert raw.execute("SELECT current_setting('app.current_user_id', true) AS v").fetchone()["v"] == OMAR
        raw.execute("COMMIT")
        leftover = raw.execute("SELECT current_setting('app.current_user_id', true) AS v").fetchone()["v"]
        assert leftover in ("", None)
    with psycopg.connect(settings.worker_database_url, row_factory=dict_row) as worker:
        assert worker.execute("SELECT current_user AS role").fetchone()["role"] == "daftar_worker"
    with psycopg.connect(settings.database_url_super, row_factory=dict_row) as admin:
        rows = admin.execute(
            """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            """
        ).fetchall()
        names = {row["relname"] for row in rows}
        assert {"bank_transactions", "files", "statements", "parser_profiles", "jobs"} <= names
        assert all(row["relrowsecurity"] and row["relforcerowsecurity"] for row in rows)
    conn.execute("SELECT 1")
    conn.commit()
    peek = conn._raw.execute("SELECT current_setting('app.current_user_id', true) AS v").fetchone()["v"]
    conn._raw.rollback()
    assert peek in ("", None)


def test_profiles_are_keyed_by_bank_file_type_and_header_fingerprint(ctx):
    conn, storage = ctx
    _ingest(conn, storage, "statement_utf8.csv", confirm=True)
    xlsx_id = _ingest(conn, storage, "statement_title.xlsx", confirm=False)
    xlsx = _statement(conn, xlsx_id)
    assert xlsx["error"] == "mapping_unconfirmed"
    assert _rows(conn, xlsx_id) == []
    odd_id = _ingest(conn, storage, "statement_odd.csv", account_id=NORTHWIND, confirm=False)
    odd = _statement(conn, odd_id)
    assert odd["error"] == "mapping_unconfirmed"
    assert odd["proposed_mapping"]["fileType"] == "csv"
    assert odd["proposed_mapping"]["headerFingerprint"] != xlsx["proposed_mapping"]["headerFingerprint"]
    _confirm(conn, odd_id)
    reused = _ingest(conn, storage, "statement_odd_feb.csv", account_id=NORTHWIND, confirm=False)
    assert _statement(conn, reused)["error"] is None
    assert len(_rows(conn, reused)) == 2
    profiles = conn.execute(
        "SELECT bank_name, file_type, header_fingerprint FROM parser_profiles ORDER BY file_type"
    ).fetchall()
    keys = [(row["bank_name"], row["file_type"], row["header_fingerprint"]) for row in profiles]
    assert len(keys) == len(set(keys))
    assert {row["file_type"] for row in profiles} == {"csv"}
    assert len({row["header_fingerprint"] for row in profiles}) == 2
    assert {row["bank_name"] for row in profiles} == {"Northwind Commercial Bank"}


def test_worker_queue_claims_a_job(ctx):
    conn, storage = ctx
    content = (FIXTURES / "statement_utf8.csv").read_bytes()
    created = register_upload(
        conn,
        storage,
        client_id=AL_NOOR,
        bank_account_id=NORTHWIND,
        uploaded_by=OMAR,
        filename="queued.csv",
        content=content,
        enqueue=True,
    )
    from daftar.pipeline import claim_and_run_once

    assert claim_and_run_once(load_settings()) is True
    statement = _statement(conn, created["statementId"])
    assert statement["status"] in {"needs_review", "parsed"}
    assert statement["error"] in {"mapping_unconfirmed", None}


def _ingest(conn, storage, name: str, account_id: str = NORTHWIND, confirm: bool = True, password: str | None = None) -> str:
    content = (FIXTURES / name).read_bytes()
    created = register_upload(
        conn,
        storage,
        client_id=AL_NOOR,
        bank_account_id=account_id,
        uploaded_by=OMAR,
        filename=name,
        content=content,
        enqueue=False,
    )
    statement_id = created["statementId"]
    if created["duplicate"]:
        return statement_id
    process_statement(conn, storage, statement_id, password)
    statement = _statement(conn, statement_id)
    if confirm and statement["error"] == "mapping_unconfirmed":
        _confirm(conn, statement_id)
    return statement_id


def _confirm(conn, statement_id: str) -> None:
    proposal = _statement(conn, statement_id)["proposed_mapping"]
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


def _expected(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def _statement(conn, statement_id: str):
    return conn.execute("SELECT * FROM statements WHERE id = %s", (statement_id,)).fetchone()


def _rows(conn, statement_id: str):
    return conn.execute(
        """
        SELECT row_no, txn_date, description_raw, debit_minor, credit_minor, balance_minor,
               reference, flags, review_status, source_page, source_bbox
        FROM bank_transactions
        WHERE statement_id = %s
        ORDER BY row_no
        """,
        (statement_id,),
    ).fetchall()


def _methods(conn, statement_id: str) -> set[str]:
    rows = conn.execute(
        "SELECT method FROM processing_events WHERE statement_id = %s",
        (statement_id,),
    ).fetchall()
    return {row["method"] for row in rows}


def _event_count(conn) -> int:
    return conn.execute("SELECT count(*) AS n FROM processing_events").fetchone()["n"]


def _assert_amounts(conn, statement_id: str, expected: dict, descriptions: bool = True) -> None:
    rows = _rows(conn, statement_id)
    assert len(rows) == len(expected["transactions"])
    for actual, wanted in zip(rows, expected["transactions"], strict=True):
        assert actual["debit_minor"] == wanted["debit_minor"]
        assert actual["credit_minor"] == wanted["credit_minor"]
        assert actual["balance_minor"] == wanted["balance_minor"]
        assert str(actual["txn_date"]) == wanted["txn_date"]
        assert isinstance(actual["debit_minor"], int) or actual["debit_minor"] is None
        if descriptions:
            assert actual["description_raw"] == wanted["description"]
        if not expected["expect_ocr"]:
            assert actual["reference"] == wanted["reference"]
