"""Detect file type from content, not from the filename."""

from __future__ import annotations

import io
import zipfile


def sniff(content: bytes) -> tuple[str, str]:
    """Return (kind, mime). kind is pdf, image, xlsx, xls, csv, or unknown."""
    if content.startswith(b"%PDF"):
        return "pdf", "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if content.startswith(b"II*\x00") or content.startswith(b"MM\x00*"):
        return "image", "image/tiff"
    if _is_heic(content):
        return "image", "image/heic"
    if content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "xls", "application/vnd.ms-excel"
    if content.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile:
            return "unknown", "application/octet-stream"
        if any(name.startswith("xl/") for name in names):
            return "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return "unknown", "application/zip"
    if _looks_textual(content):
        return "csv", "text/csv"
    return "unknown", "application/octet-stream"


def _is_heic(content: bytes) -> bool:
    if len(content) < 12:
        return False
    brand = content[4:12]
    return brand.startswith(b"ftyp") and any(
        token in content[4:32] for token in (b"heic", b"heif", b"mif1", b"heix")
    )


def _looks_textual(content: bytes) -> bool:
    sample = content[:4096]
    if not sample:
        return False
    if b"\x00" in sample:
        return False
    textish = sum(1 for b in sample if b in (9, 10, 13) or 32 <= b <= 126 or b >= 128)
    return textish / len(sample) > 0.9
