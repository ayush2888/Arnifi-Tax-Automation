from __future__ import annotations

import csv
import io
from daftar.parsers.base import ParsedDocument, ParsedLine


class StripeBalanceHistoryParser:
    name = "stripe_balance_history"

    def can_parse(self, filename: str, mime: str, sample: bytes) -> int:
        name = filename.lower()
        head = sample.decode("utf-8", errors="ignore").lower()
        if "stripe" in name or "balance_history" in name:
            return 95
        if "reporting_category" in head and "gross" in head:
            return 90
        return 0

    def parse(self, filename: str, mime: str, content: bytes) -> ParsedDocument:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        lines: list[ParsedLine] = []
        for row in reader:
            norm = {k.strip().lower(): v for k, v in row.items() if k}
            # Stripe amounts often in major units as strings.
            gross = _minor(norm.get("gross") or norm.get("amount"))
            fee = _minor(norm.get("fee"))
            category = str(norm.get("reporting_category") or norm.get("type") or "charge")
            created = str(norm.get("created") or norm.get("available_on") or "")[:10] or None
            if gross:
                lines.append(
                    ParsedLine(
                        description=f"stripe:{category}",
                        amount_minor=abs(gross),
                        currency=(norm.get("currency") or "AED").upper()[:3],
                        txn_date=created,
                        debit=gross < 0,
                        meta={"gateway": "stripe", "category": category, "fee_minor": fee},
                    )
                )
            if fee:
                lines.append(
                    ParsedLine(
                        description=f"stripe:fee:{category}",
                        amount_minor=abs(fee),
                        currency=(norm.get("currency") or "AED").upper()[:3],
                        txn_date=created,
                        debit=True,
                        meta={"gateway": "stripe", "category": "fee"},
                    )
                )
        return ParsedDocument(
            doc_type="GATEWAY_CSV",
            party="Stripe",
            document_date=lines[0].txn_date if lines else None,
            period_hint=lines[0].txn_date if lines else None,
            currency="AED",
            lines=lines,
            confidence=93,
            extras={"gateway": "stripe"},
        )


def _minor(raw: str | None) -> int:
    if not raw:
        return 0
    cleaned = str(raw).replace(",", "").strip()
    if not cleaned:
        return 0
    # Stripe CSV sometimes already in cents as integer strings without decimal.
    if "." not in cleaned and cleaned.lstrip("-").isdigit() and abs(int(cleaned)) > 1000:
        # Heuristic: treat large integers without decimals as already minor when filename says stripe? Prefer major.
        pass
    return int(round(float(cleaned) * 100))
