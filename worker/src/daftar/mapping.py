"""Column headers are mapped to fields by a confirmed parser profile.

The first time a bank is seen, the worker only proposes a map. An accountant
confirms it. Later statements from that bank reuse the confirmed profile.
"""

from __future__ import annotations

import re
from datetime import datetime


FIELDS = (
    "txn_date",
    "value_date",
    "description",
    "amount",
    "debit",
    "credit",
    "balance",
    "reference",
    "counterparty",
)

SYNONYMS: dict[str, tuple[str, ...]] = {
    "txn_date": (
        "date",
        "transaction date",
        "txn date",
        "posting date",
        "posting",
        "book date",
        "تاريخ",
        "تاريخ العملية",
        "تاريخ الحركة",
    ),
    "value_date": ("value date", "value dt", "تاريخ القيمة"),
    "description": (
        "description",
        "narrative",
        "narr",
        "details",
        "particulars",
        "transaction details",
        "البيان",
        "الوصف",
        "التفاصيل",
        "شرح",
    ),
    # Single signed column (Wio and many modern banks): negative = money out.
    "amount": (
        "amount",
        "amt",
        "transaction amount",
        "txn amount",
        "amount (incl. vat)",
        "amount incl vat",
        "amount (incl vat)",
        "المبلغ",
    ),
    "debit": (
        "debit",
        "withdrawal",
        "money out",
        "outflow",
        "out",
        "dr",
        "مدين",
        "سحب",
    ),
    "credit": (
        "credit",
        "deposit",
        "money in",
        "inflow",
        "in",
        "cr",
        "دائن",
        "إيداع",
    ),
    "balance": (
        "balance",
        "running balance",
        "runbal",
        "running bal",
        "ledger balance",
        "الرصيد",
    ),
    "reference": (
        "reference",
        "ref",
        "ref.",
        "refno",
        "ref no",
        "ref. number",
        "ref number",
        "reference number",
        "cheque",
        "cheque no",
        "المرجع",
        "رقم المرجع",
    ),
    "counterparty": (
        "counterparty",
        "beneficiary",
        "payee",
        "party",
        "الطرف",
        "المستفيد",
    ),
}


def norm_header(value: str) -> str:
    text = value.strip().casefold()
    text = text.replace("(incl. vat)", "").replace("(incl vat)", "")
    text = re.sub(r"[^\w\s./-]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip(" .-")


def field_for_header(header: str) -> str | None:
    token = norm_header(header)
    if not token:
        return None
    compact = re.sub(r"[\s./-]+", "", token)
    for field, words in SYNONYMS.items():
        for word in words:
            if token == word or compact == re.sub(r"[\s./-]+", "", word):
                return field
    # PDF/OCR often emits only the first word of a multi-word header.
    if token in {"amount", "amt", "المبلغ"} or compact in {"amount", "amt"}:
        return "amount"
    if token in {"ref", "ref.", "reference", "cheque", "المرجع"} or compact in {"ref", "reference", "cheque"}:
        return "reference"
    return None


def header_fingerprint(headers: list[str]) -> str:
    """Stable id for a header row. Case and surrounding space do not create a new profile."""
    import hashlib

    normalized = "\n".join(header.strip().casefold() for header in headers)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def propose_column_map(headers: list[str]) -> dict[str, str]:
    proposal: dict[str, str] = {}
    used: set[str] = set()
    for header in headers:
        field = field_for_header(header)
        if field and field not in used and header.strip():
            proposal[field] = header.strip()
            used.add(field)
    return proposal


def profile_fits(column_map: dict, headers: list[str]) -> bool:
    present = {h.strip() for h in headers if h and str(h).strip()}
    for field in ("txn_date", "description"):
        source = column_map.get(field)
        if not source or source not in present:
            return False
    if not any(column_map.get(field) in present for field in ("debit", "credit", "amount", "balance")):
        return False
    for source in column_map.values():
        if source and source not in present:
            return False
    return True


DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y/%m/%d",
    "%d/%m/%y",
)


def detect_date_format(samples: list[str]) -> str:
    usable = []
    for sample in samples:
        token = first_date_token(sample)
        if not token:
            continue
        # Keep only tokens that parse under at least one known format.
        if any(True for fmt in DATE_FORMATS if _parses_date(token, fmt)):
            usable.append(token)
    if not usable:
        return "%Y-%m-%d"

    matching = [fmt for fmt in DATE_FORMATS if all(_parses_date(value, fmt) for value in usable[:12])]
    if "%Y-%m-%d" in matching:
        return "%Y-%m-%d"
    if "%d/%m/%Y" in matching and "%m/%d/%Y" in matching:
        for value in usable:
            parts = re.split(r"[./-]", value)
            if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
                continue
            day_first, month_first = int(parts[0]), int(parts[1])
            if day_first > 12:
                return "%d/%m/%Y"
            if month_first > 12:
                return "%m/%d/%Y"
        return "%d/%m/%Y"
    for preferred in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d"):
        if preferred in matching:
            return preferred
    return matching[0] if matching else "%Y-%m-%d"


def detect_separators(samples: list[str]) -> tuple[str, str]:
    """Return (decimal_separator, thousands_separator)."""
    for raw in samples:
        text = raw or ""
        if "," in text and "." in text:
            return (",", ".") if text.rfind(",") > text.rfind(".") else (".", ",")
    comma_decimal = 0
    dot_decimal = 0
    for raw in samples:
        text = re.sub(r"[^\d.,]", "", raw or "")
        if re.search(r",\d{1,2}$", text) and "." not in text:
            comma_decimal += 1
        if re.search(r"\.\d{1,2}$", text) and "," not in text:
            dot_decimal += 1
    if comma_decimal > dot_decimal:
        return ",", "."
    return ".", ","


DATE_TOKEN_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b"
)


def _parses_date(value: str, fmt: str) -> bool:
    try:
        datetime.strptime(value, fmt)
        return True
    except ValueError:
        return False


def first_date_token(value: str | None) -> str | None:
    """Pull the first date-looking token out of a cell that may also hold a ref."""
    text = (value or "").strip()
    if not text or text in {"-", "—", "–"}:
        return None
    match = DATE_TOKEN_RE.search(text)
    return match.group(1) if match else None


def parse_date(value: str | None, date_format: str):
    token = first_date_token(value)
    if not token:
        return None
    try:
        return datetime.strptime(token, date_format).date()
    except ValueError:
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(token, fmt).date()
            except ValueError:
                continue
        return None
