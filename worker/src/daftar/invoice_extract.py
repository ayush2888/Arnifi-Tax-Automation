"""Sales / purchase invoice extraction (worker job `invoice_extract`).

Text-layer PDFs are read directly. Scans and images go through the shared
`recognize` OCR adapter (local Tesseract). Every field is a proposal: the
accountant reviews and edits it before anything is posted.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime

from psycopg.types.json import Json

from daftar.money import MoneyError, parse_amount

logger = logging.getLogger("daftar.invoice_extract")

EXTRACTOR = "invoice_text_v1"
RATE_SCALE = 100_000_000
USD_AED_PEG_SCALED = 367_250_000  # CBUAE fixed peg 3.6725 AED per USD

CURRENCIES = ("AED", "USD", "EUR", "GBP", "SAR", "INR", "OMR", "QAR", "KWD", "BHD")
_CUR = r"(?:AED|USD|EUR|GBP|SAR|INR|OMR|QAR|KWD|BHD|DHS?\.?)"
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"
MONEY_ONLY_RE = re.compile(rf"^\s*(?P<cur>{_CUR})?\s*(?P<num>{_NUM})\s*(?P<cur2>{_CUR})?\s*$", re.I)
MONEY_IN_LINE_RE = re.compile(rf"(?P<cur>{_CUR})?\s*(?P<num>{_NUM})(?!\d)", re.I)

MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec"
DATE_RE = re.compile(
    rf"\b(\d{{4}}-\d{{2}}-\d{{2}}"
    rf"|\d{{1,2}}[/.-]\d{{1,2}}[/.-]\d{{4}}"
    rf"|\d{{1,2}}[\s-](?:{MONTHS})[a-z]*[\s,-]+\d{{4}}"
    rf"|(?:{MONTHS})[a-z]*\s+\d{{1,2}},?\s+\d{{4}})\b",
    re.I,
)
TRN_RE = re.compile(r"(?<!\d)(1\d{14})(?!\d)")
LEGAL_SUFFIX_RE = re.compile(
    r"\b(L\.?\s?L\.?\s?C\.?|FZ-?\s?CO|FZE|FZ\s?LLC|DMCC|LTD\.?|LIMITED|PJSC|INC\.?|GMBH|LLP|EST\.?|ESTABLISHMENT)\b",
    re.I,
)

INVOICE_NO_LABEL_RE = re.compile(
    r"\b(?:tax\s+)?(?:invoice|proforma|bill|credit\s+note|debit\s+note)\s*(?:#|no\.?|number|num\.?)\s*[:\-]?",
    re.I,
)
DATE_LABEL_RE = re.compile(
    r"\b(?:invoice\s+date|proforma\s+date|date\s+of\s+(?:issue|supply)|tax\s+point(?:\s+date)?|issue\s+date|bill\s+date|date)\b\s*[:\-]?",
    re.I,
)
DUE_LABEL_RE = re.compile(r"\bdue\s+date\b\s*[:\-]?", re.I)
BILL_TO_RE = re.compile(r"^\s*(?:bill(?:ed)?\s+to|invoice\s+to|sold\s+to|customer(?:\s+name)?|client)\b\s*[:\-]?", re.I)
SUBTOTAL_RE = re.compile(
    r"\b(?:sub\s*-?\s*total|taxable\s+(?:amount|value)|total\s+excl(?:uding)?\.?\s*(?:vat|tax)|net\s+amount|amount\s+before\s+(?:vat|tax))\b",
    re.I,
)
TOTAL_RE = re.compile(
    r"^\s*(?:grand\s+)?total(?:\s+(?:amount|due|payable|incl(?:uding|\.)?\s*(?:vat|tax)))?\b|\b(?:amount|balance)\s+due\b|\bgrand\s+total\b",
    re.I,
)
TOTAL_EXCLUDE_RE = re.compile(r"sub\s*-?\s*total|in\s+words|total\s+(?:vat|tax)\b|excl", re.I)
VAT_RE = re.compile(r"\bvat\b|\btax\b(?!\s*invoice)", re.I)
VAT_EXCLUDE_RE = re.compile(r"\btrn\b|registration|vat\s*(?:no|number|reg)|\(vat\)|tax\s+invoice|vat\s+#", re.I)
RATE_RE = re.compile(r"(\d{1,2}(?:\.\d+)?)\s*%")
ITEM_HEADER_RE = re.compile(r"^\s*(?:description|item(?:\s+description)?|particulars|services?|details)\s*$", re.I)
ITEM_STOP_RE = re.compile(r"^\s*(?:sub\s*-?\s*total|total|grand|vat|tax|thank|notes?|terms)\b", re.I)
LABEL_WORDS = {
    "date", "invoice #", "invoice", "qty", "quantity", "uom", "unit", "price", "rate", "amount", "line",
    "item id", "po", "#", "description", "total", "reference :", "reference", "bill to", "ship to",
}
GOV_FEE_RE = re.compile(
    r"\b(government\s+fees?|govt\.?\s+fees?|IFZA|DED|ICP|GDRFA|MOHRE|immigration|visa\s+fees?|emirates\s+id|"
    r"ministry|trade\s+licen[cs]e\s+fees?|establishment\s+card|amendment)\b",
    re.I,
)
GOV_FEE_PHRASE_RE = re.compile(r"\b(?:government|govt\.?)\s+fees?\b", re.I)
INCLUSIVE_RE = re.compile(r"(?:prices?|amounts?)\s+(?:are\s+)?inclu(?:de|sive)[^.]{0,40}tax|vat\s+inclusive|incl\.?\s+vat", re.I)


# ---------------------------------------------------------------- helpers


def _lines(text: str) -> list[str]:
    out = []
    for raw in (text or "").splitlines():
        line = re.sub(r"[ \t\u00a0]+", " ", raw).strip()
        if line:
            out.append(line)
    return out


def _is_label(line: str) -> bool:
    return line.strip().strip(":").strip().lower() in LABEL_WORDS


def parse_doc_date(token: str | None) -> str | None:
    if not token:
        return None
    text = re.sub(r"\s+", " ", token.strip().replace(",", " ")).strip()
    text = re.sub(r"(?i)\bsept\b", "Sep", text)
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%b %d %Y",
        "%B %d %Y",
    ):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _money(num: str) -> int | None:
    try:
        return parse_amount(num, decimal_sep=".", thousands_sep=",")
    except (MoneyError, TypeError):
        return None


def _currency_of(raw: str | None) -> str | None:
    if not raw:
        return None
    code = raw.upper().rstrip(".")
    if code.startswith("DH"):
        return "AED"
    return code if code in CURRENCIES else None


def _amount_near(lines: list[str], index: int, label_match: re.Match | None, ahead: int = 3):
    """Amount on the label line (after the label) or on the next money-only line."""
    line = lines[index]
    rest = line[label_match.end():] if label_match else line
    rate = RATE_RE.search(rest)
    if rate:
        rest = rest[rate.end():]
    for m in MONEY_IN_LINE_RE.finditer(rest):
        value = _money(m.group("num"))
        if value is not None and (m.group("cur") or "." in m.group("num") or "," in m.group("num") or value >= 100):
            return value, _currency_of(m.group("cur"))
    for offset in range(1, ahead + 1):
        if index + offset >= len(lines):
            break
        nxt = lines[index + offset]
        m = MONEY_ONLY_RE.match(nxt)
        if m:
            value = _money(m.group("num"))
            if value is not None:
                return value, _currency_of(m.group("cur") or m.group("cur2"))
        if not _is_label(nxt) and re.search(r"[A-Za-z]{3,}", nxt):
            break
    return None, None


def _value_after_label(lines: list[str], label_re: re.Pattern, value_fn, ahead: int = 4, exclude: re.Pattern | None = None):
    for i, line in enumerate(lines):
        m = label_re.search(line)
        if not m or (exclude and exclude.search(line)):
            continue
        same = value_fn(line[m.end():])
        if same:
            return same
        for offset in range(1, ahead + 1):
            if i + offset >= len(lines):
                break
            candidate = value_fn(lines[i + offset])
            if candidate:
                return candidate
    return None


def _invoice_no_from(fragment: str) -> str | None:
    for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9\-/_.]{2,30}", fragment):
        if not re.search(r"\d", token):
            continue
        if parse_doc_date(token) or TRN_RE.fullmatch(token):
            continue
        return token.strip(".-")
    return None


def _date_from(fragment: str) -> str | None:
    m = DATE_RE.search(fragment)
    return parse_doc_date(m.group(1)) if m else None


def _norm(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def names_match(company: str | None, party: str | None) -> bool:
    """Loose match so 'Alphacntrl' still matches 'ALPHACTRL AI SOFTWARE SERVICES - FZCO'."""
    c, p = _norm(company), _norm(party)
    if len(c) < 4 or not p:
        return False
    if c in p or p in c:
        return True
    tolerance = max(1, len(c) // 6)
    for size in (len(c) - 1, len(c), len(c) + 1):
        if size > 0 and _edit_distance(c, p[:size]) <= tolerance:
            return True
    return False


def _clean_party(line: str) -> str:
    line = re.sub(r"(?i)\b(?:tax\s+invoice|proforma\s+invoice|invoice|bill\s+to|bill|to)\s*[:\-]?\s*$", "", line).strip()
    suffix = LEGAL_SUFFIX_RE.search(line)
    if suffix:
        line = line[: suffix.end()]
    return line.strip(" ,-:|")


# ---------------------------------------------------------------- parse


def parse_invoice_text(
    text: str,
    *,
    doc_type: str,
    company_names: list[str] | None = None,
    company_trn: str | None = None,
) -> dict:
    """Pure: invoice text -> proposed facts (original currency, minor units)."""
    lines = _lines(text)
    joined = "\n".join(lines)
    warnings: list[str] = []
    confidence: dict[str, int] = {}

    if re.search(r"pro\s*-?\s*forma", joined, re.I):
        doc_kind = "PROFORMA"
    elif re.search(r"\bquotation\b|\bestimate\b", joined, re.I):
        doc_kind = "QUOTATION"
    elif re.search(r"credit\s+note", joined, re.I):
        doc_kind = "CREDIT_NOTE"
    elif re.search(r"tax\s+invoice", joined, re.I):
        doc_kind = "TAX_INVOICE"
    elif re.search(r"\binvoice\b", joined, re.I):
        doc_kind = "INVOICE"
        warnings.append("missing_tax_invoice_title")
    else:
        doc_kind = "UNKNOWN"
        warnings.append("not_an_invoice")
    if doc_kind in ("PROFORMA", "QUOTATION"):
        warnings.append("not_a_tax_invoice")

    invoice_number = _value_after_label(lines, INVOICE_NO_LABEL_RE, _invoice_no_from)
    confidence["invoiceNumber"] = 90 if invoice_number else 0

    entry_date = _value_after_label(lines, DATE_LABEL_RE, _date_from, exclude=DUE_LABEL_RE)
    confidence["entryDate"] = 90 if entry_date else 0
    if not entry_date:
        any_date = DATE_RE.search(joined)
        entry_date = parse_doc_date(any_date.group(1)) if any_date else None
        confidence["entryDate"] = 50 if entry_date else 0
    due_date = _value_after_label(lines, DUE_LABEL_RE, _date_from)

    bill_to_idx = next((i for i, line in enumerate(lines) if BILL_TO_RE.search(line)), None)

    customer_name = None
    if bill_to_idx is not None:
        rest = BILL_TO_RE.sub("", lines[bill_to_idx]).strip(" :-")
        candidates = ([rest] if rest else []) + lines[bill_to_idx + 1 : bill_to_idx + 5]
        for candidate in candidates:
            if re.search(r"[A-Za-z]{3,}", candidate) and not _is_label(candidate) and not TRN_RE.search(candidate):
                customer_name = _clean_party(candidate)
                break

    issuer_name = None
    search_zone = lines[:bill_to_idx] if bill_to_idx else lines
    for line in search_zone + ([] if bill_to_idx is None else lines[bill_to_idx:]):
        if LEGAL_SUFFIX_RE.search(line) and _clean_party(line) != customer_name:
            issuer_name = _clean_party(line)
            break
    confidence["parties"] = 70 if (issuer_name and customer_name) else 40

    issuer_trn = customer_trn = None
    for i, line in enumerate(lines):
        for m in TRN_RE.finditer(line):
            trn = m.group(1)
            after_bill_to = bill_to_idx is not None and bill_to_idx <= i <= bill_to_idx + 12
            if after_bill_to and not customer_trn:
                customer_trn = trn
            elif not after_bill_to and not issuer_trn:
                issuer_trn = trn

    cur_counts: dict[str, int] = {}
    for m in re.finditer(rf"\b({_CUR})\s?\d", joined, re.I):
        code = _currency_of(m.group(1))
        if code:
            cur_counts[code] = cur_counts.get(code, 0) + 1
    if re.search(r"uae\s+dirham", joined, re.I):
        cur_counts["AED"] = cur_counts.get("AED", 0) + 1
    currency = max(cur_counts, key=cur_counts.get) if cur_counts else "AED"
    if not cur_counts:
        warnings.append("currency_assumed_aed")

    totals = []
    subtotal = vat = None
    vat_rate = None
    for i, line in enumerate(lines):
        if SUBTOTAL_RE.search(line) and subtotal is None:
            value, _ = _amount_near(lines, i, SUBTOTAL_RE.search(line))
            if value is not None:
                subtotal = value
            continue
        m = TOTAL_RE.search(line)
        if m and not TOTAL_EXCLUDE_RE.search(line):
            value, _ = _amount_near(lines, i, m)
            if value is not None:
                totals.append(value)
            continue
        if VAT_RE.search(line) and not VAT_EXCLUDE_RE.search(line) and vat is None:
            rate = RATE_RE.search(line)
            if rate:
                vat_rate = rate.group(1)
            value, _ = _amount_near(lines, i, VAT_RE.search(line))
            if value is not None:
                vat = value
    total = max(totals) if totals else None

    confidence["total"] = 90 if total is not None else 0
    confidence["vat"] = 90 if vat is not None else 0
    if total is not None and vat is not None and subtotal is None:
        subtotal = total - vat
    elif total is not None and subtotal is not None and vat is None:
        vat = max(0, total - subtotal)
        confidence["vat"] = 70
    elif subtotal is not None and vat is not None and total is None:
        total = subtotal + vat
        confidence["total"] = 70
    elif total is not None and subtotal is None and vat is None:
        subtotal, vat = total, 0
        if INCLUSIVE_RE.search(joined):
            warnings.append("prices_include_tax_not_split")
        elif doc_kind not in ("PROFORMA", "QUOTATION"):
            warnings.append("vat_not_found")
    if None not in (subtotal, vat, total) and subtotal + vat != total:
        warnings.append("totals_dont_add_up")
    if subtotal and vat and abs(vat * 10_000 // subtotal - 500) > 5:
        warnings.append("vat_rate_not_5pct")
    if total is None:
        warnings.append("total_not_found")

    items: list[str] = []
    header_idx = next((i for i, line in enumerate(lines) if ITEM_HEADER_RE.match(line)), None)
    if header_idx is not None:
        for line in lines[header_idx + 1 : header_idx + 40]:
            if ITEM_STOP_RE.match(line):
                break
            if _is_label(line) or MONEY_ONLY_RE.match(line) or len(re.findall(r"[A-Za-z]", line)) < 4:
                continue
            items.append(line[:120])
            if len(items) >= 10:
                break
    if any(GOV_FEE_RE.search(item) for item in items) or GOV_FEE_PHRASE_RE.search(joined):
        warnings.append("possible_government_fees")

    names = [n for n in (company_names or []) if n]
    ours_is_issuer = any(names_match(n, issuer_name) for n in names) or bool(company_trn and company_trn == issuer_trn)
    ours_is_customer = any(names_match(n, customer_name) for n in names) or bool(company_trn and company_trn == customer_trn)
    if doc_type == "SALES_INVOICE":
        counterparty, counterparty_trn = customer_name, customer_trn
        if ours_is_customer and not ours_is_issuer:
            warnings.append("looks_like_purchase")
        elif not ours_is_issuer and names:
            warnings.append("company_not_issuer")
    else:
        counterparty, counterparty_trn = issuer_name, issuer_trn
        if ours_is_issuer and not ours_is_customer:
            warnings.append("looks_like_sales")
        elif not ours_is_customer and names:
            warnings.append("company_not_customer")
        if not issuer_trn:
            warnings.append("supplier_trn_missing")

    if not invoice_number:
        warnings.append("invoice_number_not_found")
    if not entry_date:
        warnings.append("date_not_found")

    overall = min(confidence.get("invoiceNumber", 0), confidence.get("entryDate", 0), confidence.get("total", 0))
    return {
        "extractor": EXTRACTOR,
        "docKind": doc_kind,
        "invoiceNumber": invoice_number,
        "entryDate": entry_date,
        "dueDate": due_date,
        "issuerName": issuer_name,
        "issuerTrn": issuer_trn,
        "customerName": customer_name,
        "customerTrn": customer_trn,
        "counterparty": counterparty,
        "counterpartyTrn": counterparty_trn,
        "supplierTrn": issuer_trn if doc_type == "PURCHASE_INVOICE" else None,
        "currency": currency,
        "originalSubtotalMinor": subtotal,
        "originalVatMinor": vat,
        "originalTotalMinor": total,
        "vatRatePct": vat_rate,
        "lineItems": items,
        "memo": items[0] if items else None,
        "warnings": sorted(set(warnings)),
        "confidence": confidence,
        "overallConfidence": overall,
    }


def to_aed(original_minor: int | None, rate_scaled: int | None) -> int | None:
    if original_minor is None or rate_scaled is None:
        return None
    sign = -1 if original_minor < 0 else 1
    return sign * ((abs(original_minor) * rate_scaled + RATE_SCALE // 2) // RATE_SCALE)


def apply_fx(facts: dict, rate_scaled: int | None, source: str | None) -> dict:
    """Fill AED amounts. AED invoices use rate 1. Missing rate leaves AED blank + warning."""
    currency = facts.get("currency") or "AED"
    warnings = set(facts.get("warnings") or [])
    if currency == "AED":
        rate_scaled, source = RATE_SCALE, "aed"
    facts["fxRateScaled"] = rate_scaled
    facts["fxSource"] = source
    if rate_scaled is None:
        warnings.add("fx_rate_needed")
    elif source == "usd_peg_default":
        warnings.add("fx_rate_defaulted")
    facts["taxableMinor"] = to_aed(facts.get("originalSubtotalMinor"), rate_scaled)
    facts["vatMinor"] = to_aed(facts.get("originalVatMinor"), rate_scaled)
    if facts["taxableMinor"] is not None and facts["vatMinor"] is not None:
        facts["totalMinor"] = facts["taxableMinor"] + facts["vatMinor"]
    else:
        facts["totalMinor"] = None
    facts["warnings"] = sorted(warnings)
    return facts


# ---------------------------------------------------------------- text


def read_invoice_text(content: bytes) -> tuple[str, str]:
    """Return (text, method). method: pdf_text | ocr."""
    from daftar.sniff import sniff

    kind, _mime = sniff(content)
    if kind == "pdf":
        import fitz

        document = fitz.open(stream=content, filetype="pdf")
        try:
            text = "\n".join(page.get_text() for page in document)
            if len(re.sub(r"\s+", "", text)) >= 40:
                return text, "pdf_text"
            from PIL import Image

            pages = []
            for page in document:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                pages.append(_ocr_lines(image))
            return "\n".join(pages), "ocr"
        finally:
            document.close()
    if kind == "image":
        import io

        from PIL import Image, ImageOps

        image = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert("RGB")
        return _ocr_lines(image), "ocr"
    raise ValueError(f"unsupported_invoice_type:{kind}")


def _ocr_lines(image) -> str:
    from daftar.extract import _cluster_lines, recognize

    _processed, tokens = recognize(image)
    return "\n".join(" ".join(token.text for token in line) for line in _cluster_lines(tokens))


# ---------------------------------------------------------------- job


def _payload(job: dict) -> dict:
    raw = job.get("payload") or {}
    return json.loads(raw) if isinstance(raw, str) else dict(raw)


def _as_iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def run_invoice_extract(conn, storage, job: dict) -> None:
    document_id = _payload(job).get("documentId")
    if not document_id:
        raise ValueError("documentId_required")
    doc = conn.execute(
        """
        SELECT d.id, d.client_id, d.period_id, d.doc_type, d.status, d.file_id, d.created_by,
               f.storage_key, c.name AS client_name, c.trn AS client_trn, c.firm_id,
               p.period_start, p.period_end, p.label AS period_label,
               cp.legal_name, cp.trn AS profile_trn
        FROM documents d
        JOIN files f ON f.id = d.file_id
        JOIN clients c ON c.id = d.client_id
        JOIN accounting_periods p ON p.id = d.period_id
        LEFT JOIN client_profile cp ON cp.client_id = d.client_id
        WHERE d.id = %s
        """,
        (document_id,),
    ).fetchone()
    if not doc:
        raise ValueError("document_not_found")
    if doc["status"] in ("posted", "rejected"):
        return

    content = storage.get(doc["storage_key"])
    text, method = read_invoice_text(content)
    facts = parse_invoice_text(
        text,
        doc_type=doc["doc_type"],
        company_names=[doc["client_name"], doc["legal_name"]],
        company_trn=doc["profile_trn"] or doc["client_trn"],
    )
    facts["method"] = method
    facts["ocrUsed"] = method == "ocr"
    if method == "ocr":
        facts["overallConfidence"] = min(facts["overallConfidence"], 60)
        facts["warnings"] = sorted(set(facts["warnings"]) | {"ocr_low_confidence"})

    rate, source = None, None
    currency = facts.get("currency") or "AED"
    if currency != "AED":
        row = conn.execute(
            """
            SELECT rate_to_aed_scaled FROM fx_rate
            WHERE client_id = %s AND currency = %s AND rate_date <= COALESCE(%s::date, CURRENT_DATE)
            ORDER BY rate_date DESC LIMIT 1
            """,
            (doc["client_id"], currency, facts.get("entryDate")),
        ).fetchone()
        if row:
            rate, source = int(row["rate_to_aed_scaled"]), "client_fx_table"
        elif currency == "USD":
            rate, source = USD_AED_PEG_SCALED, "usd_peg_default"
    apply_fx(facts, rate, source)

    period_start, period_end = _as_iso(doc["period_start"]), _as_iso(doc["period_end"])
    if facts.get("entryDate") and not (period_start <= facts["entryDate"] <= period_end):
        facts["warnings"] = sorted(set(facts["warnings"]) | {"date_outside_month"})
    facts["periodLabel"] = doc["period_label"]

    if facts.get("invoiceNumber"):
        dup = conn.execute(
            """
            SELECT d.id, p.label FROM documents d
            JOIN accounting_periods p ON p.id = d.period_id
            JOIN LATERAL (
              SELECT facts_json FROM document_extractions e
              WHERE e.document_id = d.id ORDER BY version DESC LIMIT 1
            ) e ON true
            WHERE d.client_id = %s AND d.id <> %s AND d.status <> 'rejected'
              AND d.doc_type = %s
              AND lower(e.facts_json->>'invoiceNumber') = lower(%s)
            LIMIT 1
            """,
            (doc["client_id"], document_id, doc["doc_type"], facts["invoiceNumber"]),
        ).fetchone()
        if dup:
            facts["duplicateOf"] = {"documentId": str(dup["id"]), "periodLabel": dup["label"]}
            facts["warnings"] = sorted(set(facts["warnings"]) | {"duplicate_invoice_number"})

    version = conn.execute(
        "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM document_extractions WHERE document_id = %s",
        (document_id,),
    ).fetchone()["v"]
    extraction_id = conn.execute(
        """
        INSERT INTO document_extractions (document_id, client_id, version, facts_json, status)
        VALUES (%s, %s, %s, %s, 'draft') RETURNING id
        """,
        (document_id, doc["client_id"], version, Json(facts)),
    ).fetchone()["id"]
    conn.execute(
        """
        UPDATE documents
        SET status = 'needs_review', extraction_confidence = %s, ocr_used = %s
        WHERE id = %s
        """,
        (max(0, min(100, int(facts["overallConfidence"]))), facts["ocrUsed"], document_id),
    )
    conn.execute(
        """
        INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
        VALUES (%s, %s, 'document_extraction', %s, 'extract', %s, %s)
        """,
        (
            doc["firm_id"],
            doc["client_id"],
            extraction_id,
            _payload(job).get("actorUserId"),
            Json({"documentId": str(document_id), "version": version, "method": method, "warnings": facts["warnings"]}),
        ),
    )
    logger.info("invoice_extract document=%s version=%s method=%s", document_id, version, method)
