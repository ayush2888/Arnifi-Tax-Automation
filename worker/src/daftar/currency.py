"""Phase 1 currency gate.

Amounts use a fixed exponent of 2. A statement that declares KWD, BHD, or OMR
is refused before the file is stored.
"""

from __future__ import annotations

import re

from daftar.errors import CodedError
from daftar.money import THREE_DECIMAL_CURRENCIES

CURRENCY_RE = re.compile(r"currency\s*[:|,]\s*([A-Za-z]{3})", re.I)


def declared_currency(content: bytes) -> str | None:
    """Read a Currency header from text or from spreadsheet XML."""
    for encoding in ("utf-8", "latin-1"):
        match = CURRENCY_RE.search(content.decode(encoding, errors="ignore"))
        if match:
            return match.group(1).upper()
    return None


def unsupported_currency_message(code: str) -> str:
    return (
        f"{code} is quoted to 3 decimal places. "
        "Phase 1 accepts only currencies quoted to 2 decimal places, such as AED."
    )


def reject_unsupported_currency(code: str | None) -> None:
    if not code or code.upper() not in THREE_DECIMAL_CURRENCIES:
        return
    raise CodedError("unsupported_currency", unsupported_currency_message(code.upper()))
