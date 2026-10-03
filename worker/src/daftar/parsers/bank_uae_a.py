from __future__ import annotations

import csv
import io
from daftar.parsers.base import ParsedDocument, ParsedLine


class BankUaeAParser:
    """Northwind-style CSV: Date,Description,Debit,Credit,Balance,Reference"""

    name = "bank_uae_a"

    def can_parse(self, filename: str, mime: str, sample: bytes) -> int:
        head = sample.decode("utf-8", errors="ignore").splitlines()[:1]
        if not head:
            return 0
        cols = [c.strip().lower() for c in head[0].split(",")]
        if {"date", "description", "debit", "credit", "balance"}.issubset(set(cols)):
            return 92
        if "northwind" in filename.lower() or "uae_a" in filename.lower():
            return 70
        return 0

    def parse(self, filename: str, mime: str, content: bytes) -> ParsedDocument:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        lines: list[ParsedLine] = []
        for row in reader:
            debit = _minor(row.get("Debit") or row.get("debit"))
            credit = _minor(row.get("Credit") or row.get("credit"))
            if debit:
                lines.append(
                    ParsedLine(
                        description=str(row.get("Description") or row.get("description") or ""),
                        amount_minor=debit,
                        txn_date=str(row.get("Date") or row.get("date") or "") or None,
                        reference=str(row.get("Reference") or row.get("reference") or "") or None,
                        debit=True,
                    )
                )
            elif credit:
                lines.append(
                    ParsedLine(
                        description=str(row.get("Description") or row.get("description") or ""),
                        amount_minor=credit,
                        txn_date=str(row.get("Date") or row.get("date") or "") or None,
                        reference=str(row.get("Reference") or row.get("reference") or "") or None,
                        debit=False,
                    )
                )
        return ParsedDocument(
            doc_type="BANK_STATEMENT",
            party=None,
            document_date=lines[0].txn_date if lines else None,
            period_hint=lines[0].txn_date if lines else None,
            currency="AED",
            lines=lines,
            confidence=90,
            source_account_hints=["AE**0001"],
        )


def _minor(raw: str | None) -> int:
    if not raw:
        return 0
    cleaned = str(raw).replace(",", "").strip()
    if not cleaned:
        return 0
    return int(round(float(cleaned) * 100))
