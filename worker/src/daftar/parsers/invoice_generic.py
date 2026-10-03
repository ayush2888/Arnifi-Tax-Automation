from __future__ import annotations

import json
import re
from daftar.parsers.base import ParsedDocument, ParsedLine


class InvoiceGenericParser:
    name = "invoice_generic"

    def can_parse(self, filename: str, mime: str, sample: bytes) -> int:
        name = filename.lower()
        if name.endswith(".json") and (b"taxableMinor" in sample or b"invoiceNumber" in sample):
            return 90
        if "invoice" in name or "bill" in name or "tax" in name:
            return 50
        if mime in ("application/pdf", "text/plain") and (
            b"TAX INVOICE" in sample.upper() or b"Tax Invoice" in sample
        ):
            return 60
        return 10

    def parse(self, filename: str, mime: str, content: bytes) -> ParsedDocument:
        if filename.lower().endswith(".json"):
            data = json.loads(content.decode("utf-8"))
            taxable = int(data.get("taxableMinor") or 0)
            vat = int(data.get("vatMinor") or 0)
            doc_type = str(data.get("docType") or "SALES_INVOICE")
            return ParsedDocument(
                doc_type=doc_type,
                party=data.get("counterparty"),
                document_date=data.get("entryDate"),
                period_hint=data.get("entryDate"),
                currency=str(data.get("currency") or "AED"),
                lines=[
                    ParsedLine(
                        description=str(data.get("description") or data.get("invoiceNumber") or "invoice"),
                        amount_minor=taxable + vat,
                        currency=str(data.get("currency") or "AED"),
                        txn_date=data.get("entryDate"),
                        reference=data.get("invoiceNumber"),
                        meta={"taxableMinor": taxable, "vatMinor": vat, "is_disbursement": bool(data.get("isDisbursement"))},
                    )
                ],
                confidence=95,
                extras=data,
            )

        text = content.decode("utf-8", errors="ignore")
        amount = 0
        m = re.search(r"(?:AED|Dhs\.?)\s*([0-9,]+(?:\.\d{2})?)", text, re.I)
        if m:
            amount = int(round(float(m.group(1).replace(",", "")) * 100))
        doc_type = "PURCHASE_INVOICE" if re.search(r"bill|purchase|supplier", filename + text, re.I) else "SALES_INVOICE"
        return ParsedDocument(
            doc_type=doc_type,
            party=None,
            document_date=None,
            period_hint=None,
            currency="AED",
            lines=[ParsedLine(description=filename, amount_minor=amount, confidence=40)],
            confidence=40,
            ocr_used=False,
        )
