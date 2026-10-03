from __future__ import annotations

import csv
import io
from daftar.parsers.base import ParsedDocument, ParsedLine


class BankUaeBParser:
    """Oasis-style CSV: Txn Date,Narration,Withdrawals,Deposits,Running Balance"""

    name = "bank_uae_b"

    def can_parse(self, filename: str, mime: str, sample: bytes) -> int:
        head = sample.decode("utf-8", errors="ignore").lower()
        if "txn date" in head and "narration" in head and ("withdrawals" in head or "deposits" in head):
            return 92
        if "oasis" in filename.lower() or "uae_b" in filename.lower():
            return 70
        return 0

    def parse(self, filename: str, mime: str, content: bytes) -> ParsedDocument:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        lines: list[ParsedLine] = []
        for row in reader:
            # normalize keys
            norm = {k.strip().lower(): v for k, v in row.items() if k}
            withdraw = _minor(norm.get("withdrawals"))
            deposit = _minor(norm.get("deposits"))
            if withdraw:
                lines.append(
                    ParsedLine(
                        description=str(norm.get("narration") or ""),
                        amount_minor=withdraw,
                        txn_date=str(norm.get("txn date") or "") or None,
                        debit=True,
                    )
                )
            elif deposit:
                lines.append(
                    ParsedLine(
                        description=str(norm.get("narration") or ""),
                        amount_minor=deposit,
                        txn_date=str(norm.get("txn date") or "") or None,
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
            source_account_hints=["AE**0003"],
        )


def _minor(raw: str | None) -> int:
    if not raw:
        return 0
    cleaned = str(raw).replace(",", "").strip()
    if not cleaned:
        return 0
    return int(round(float(cleaned) * 100))
