from __future__ import annotations

import re
from daftar.parsers.base import ParsedDocument, ParsedLine


class GatewayPdfGenericParser:
    """Lightweight text extract for gateway settlement PDFs (Nomod / Network-style)."""

    name = "gateway_pdf_generic"

    def can_parse(self, filename: str, mime: str, sample: bytes) -> int:
        name = filename.lower()
        if "nomod" in name or "network" in name or "gateway" in name:
            return 70
        if mime == "application/pdf" and (b"SETTLEMENT" in sample.upper() or b"PAYOUT" in sample.upper()):
            return 55
        return 0

    def parse(self, filename: str, mime: str, content: bytes) -> ParsedDocument:
        # PDF binary: best-effort ASCII scrape (text-layer). OCR path marks low confidence upstream.
        text = content.decode("latin-1", errors="ignore")
        amounts = [int(round(float(x.replace(",", "")) * 100)) for x in re.findall(r"([0-9,]+\.\d{2})", text)]
        lines = [
            ParsedLine(
                description=f"gateway payout line {idx + 1}",
                amount_minor=amt,
                debit=False,
                confidence=45,
                meta={"gateway": "generic"},
            )
            for idx, amt in enumerate(amounts[:50])
        ]
        return ParsedDocument(
            doc_type="GATEWAY_PDF",
            party=None,
            document_date=None,
            period_hint=None,
            currency="AED",
            lines=lines or [ParsedLine(description=filename, amount_minor=0, confidence=20)],
            confidence=45,
            ocr_used=False,
        )
