"""Wio-style signed Amount column + multi-account footer filtering."""

from datetime import date

from daftar.mapping import detect_date_format, field_for_header, first_date_token, propose_column_map
from daftar.extract import Extraction, RawRow
from daftar.pipeline import _normalize
from daftar.validate import apply_validation


def test_amount_and_ref_headers_recognised():
    assert field_for_header("Amount") == "amount"
    assert field_for_header("Amount (Incl. VAT)") == "amount"
    assert field_for_header("Ref.") == "reference"
    assert field_for_header("Ref. Number") == "reference"
    assert propose_column_map(["Date", "Ref.", "Description", "Amount", "Balance"]) == {
        "txn_date": "Date",
        "reference": "Ref.",
        "description": "Description",
        "amount": "Amount",
        "balance": "Balance",
    }


def test_date_format_from_dmy_with_junk_samples():
    assert first_date_token("13/06/2026 P977961723") == "13/06/2026"
    assert detect_date_format(["13/06/2026", "25/06/2026", "within 30 days", ""]) == "%d/%m/%Y"


def test_signed_amount_normalises_and_drops_footer():
    extraction = Extraction(
        headers=["Date", "Ref.", "Description", "Amount", "Balance"],
        rows=[
            RawRow(1, 2, None, {"Date": "13/06/2026", "Ref.": "P1", "Description": "Fee", "Amount": "-99", "Balance": "7,883.51"}),
            RawRow(2, 2, None, {"Date": "25/06/2026", "Ref.": "P2", "Description": "FX in", "Amount": "5,902", "Balance": "13,785.51"}),
            RawRow(3, 2, None, {"Date": "26/06/2026", "Ref.": "P3", "Description": "FTA and report any discrepancies", "Amount": "-8,018.01", "Balance": "5,767.5"}),
            RawRow(4, 2, None, {"Date": "within 30", "Ref.": "days", "Description": "Please review this account statement", "Amount": "", "Balance": "Page 2 of 4"}),
        ],
        currency="AED",
        opening_minor=798_251,
        closing_minor=576_750,
        period_start="2026-06-01",
        period_end="2026-06-30",
        kind="pdf",
    )
    column_map = propose_column_map(extraction.headers)
    txns = _normalize(extraction, column_map, "%d/%m/%Y", ".", ",", "AED")
    assert len(txns) == 3
    assert [t.debit_minor for t in txns] == [9_900, None, 801_801]
    assert [t.credit_minor for t in txns] == [None, 590_200, None]
    assert txns[2].description_clean == "FTA"
    flags = apply_validation(
        txns,
        opening_minor=798_251,
        closing_minor=576_750,
        period_start=date(2026, 6, 1),
        period_end=date(2026, 6, 30),
        extracted_count=len(txns),
    )
    assert flags == []
