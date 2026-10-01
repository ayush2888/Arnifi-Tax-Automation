"""Synthetic statement shapes. These are not copies of any real bank's export."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Txn:
    row_no: int
    txn_date: str
    description: str
    debit_minor: int | None
    credit_minor: int | None
    balance_minor: int
    reference: str


def fmt_amount(minor: int | None) -> str:
    if minor is None:
        return ""
    sign = "-" if minor < 0 else ""
    minor = abs(minor)
    return f"{sign}{minor // 100}.{minor % 100:02d}"


def fmt_grouped(minor: int) -> str:
    sign = "-" if minor < 0 else ""
    minor = abs(minor)
    return f"{sign}{minor // 100:,}.{minor % 100:02d}"


STANDARD = [
    Txn(1, "2024-01-02", "DEWA ELECTRICITY", 25_000, None, 975_000, "R1001"),
    Txn(2, "2024-01-05", "CUSTOMER RECEIPT", None, 500_000, 1_475_000, "R1002"),
    Txn(3, "2024-01-08", "OFFICE SUPPLIES", 15_000, None, 1_460_000, "R1003"),
    Txn(4, "2024-01-15", "SALARY TRANSFER", 300_000, None, 1_160_000, "R1004"),
    Txn(5, "2024-01-20", "RENT JANUARY", 400_000, None, 760_000, "R1005"),
    Txn(6, "2024-01-28", "BANK CHARGES", 2_500, None, 757_500, "R1006"),
]

ARABIC = [
    Txn(1, "2024-01-02", "فاتورة هيئة كهرباء ومياه", 25_000, None, 975_000, "R1001"),
    Txn(2, "2024-01-05", "تحصيل من عميل", None, 500_000, 1_475_000, "R1002"),
    Txn(3, "2024-01-08", "مشتريات مكتبية", 15_000, None, 1_460_000, "R1003"),
    Txn(4, "2024-01-15", "رواتب الموظفين", 300_000, None, 1_160_000, "R1004"),
    Txn(5, "2024-01-20", "إيجار المكتب", 400_000, None, 760_000, "R1005"),
    Txn(6, "2024-01-28", "رسوم بنكية", 2_500, None, 757_500, "R1006"),
]

BROKEN = [
    Txn(1, "2024-01-02", "DEWA ELECTRICITY", 25_000, None, 975_000, "R1001"),
    Txn(2, "2024-01-05", "CUSTOMER RECEIPT", None, 500_000, 1_475_000, "R1002"),
    Txn(3, "2024-01-08", "OFFICE SUPPLIES", 15_000, None, 1_400_000, "R1003"),
    Txn(4, "2024-01-15", "SALARY TRANSFER", 300_000, None, 1_160_000, "R1004"),
    Txn(5, "2024-01-20", "RENT JANUARY", 400_000, None, 760_000, "R1005"),
    Txn(6, "2024-01-28", "BANK CHARGES", 2_500, None, 757_500, "R1006"),
]

OVERLAP_A = STANDARD[:4]
OVERLAP_B = STANDARD[2:]

FEBRUARY = [
    Txn(1, "2024-02-03", "CUSTOMER RECEIPT", None, 100_000, 857_500, "R2001"),
    Txn(2, "2024-02-10", "OFFICE SUPPLIES", 20_000, None, 837_500, "R2002"),
]

OPENING = 1_000_000
CLOSING = 757_500
PERIOD = ("2024-01-01", "2024-01-31")

STANDARD_HEADERS = ["Date", "Description", "Debit", "Credit", "Balance", "Reference"]
ODD_HEADERS = ["Posting", "Narr", "Outflow", "Inflow", "RunBal", "RefNo"]
OCR_HEADERS = ["DATE", "DESCRIPTION", "DEBIT", "CREDIT", "BALANCE", "REFERENCE"]
