"""Build synthetic statement fixtures. Output is gitignored; tests generate it."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "fixtures"))

from catalog import (  # noqa: E402
    ARABIC,
    BROKEN,
    CLOSING,
    FEBRUARY,
    OCR_HEADERS,
    ODD_HEADERS,
    OPENING,
    OVERLAP_A,
    OVERLAP_B,
    PERIOD,
    STANDARD,
    STANDARD_HEADERS,
    Txn,
    fmt_amount,
    fmt_grouped,
)

OUT = ROOT / "fixtures" / "generated"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FIXTURE_PASSWORD = "synthetic"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    scenarios = {
        "statement_utf8.csv": ("csv", STANDARD, STANDARD_HEADERS, _meta(OPENING, CLOSING), "utf-8", "northwind"),
        "statement_arabic.csv": ("csv", ARABIC, STANDARD_HEADERS, _meta(OPENING, CLOSING), "cp1256", "northwind"),
        "statement_broken.csv": ("csv", BROKEN, STANDARD_HEADERS, _meta(OPENING, CLOSING), "utf-8", "northwind"),
        "statement_wrong_closing.csv": (
            "csv",
            STANDARD,
            STANDARD_HEADERS,
            _meta(OPENING, 700_000),
            "utf-8",
            "northwind",
        ),
        "statement_overlap_a.csv": (
            "csv",
            _renumber(OVERLAP_A),
            STANDARD_HEADERS,
            _meta(OPENING, OVERLAP_A[-1].balance_minor),
            "utf-8",
            "northwind",
        ),
        "statement_overlap_b.csv": (
            "csv",
            _renumber(OVERLAP_B),
            STANDARD_HEADERS,
            _meta(1_475_000, OVERLAP_B[-1].balance_minor),
            "utf-8",
            "northwind",
        ),
        "statement_feb.csv": (
            "csv",
            FEBRUARY,
            STANDARD_HEADERS,
            _meta(757_500, 837_500, ("2024-02-01", "2024-02-29")),
            "utf-8",
            "northwind",
        ),
        "statement_odd.csv": ("csv", STANDARD, ODD_HEADERS, _meta(OPENING, CLOSING), "utf-8", "oasis"),
        "statement_odd_feb.csv": (
            "csv",
            FEBRUARY,
            ODD_HEADERS,
            _meta(757_500, 837_500, ("2024-02-01", "2024-02-29")),
            "utf-8",
            "oasis",
        ),
    }
    for name, (kind, txns, headers, meta, encoding, bank) in scenarios.items():
        path = OUT / name
        _write_csv(path, txns, headers, meta, encoding)
        _write_expected(path, txns, meta, bank, encoding, expect_ocr=False)

    xlsx = OUT / "statement_title.xlsx"
    _write_xlsx(xlsx, STANDARD, _meta(OPENING, CLOSING))
    _write_expected(xlsx, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=False)

    xls = OUT / "statement_legacy.xls"
    _write_xls(xls, STANDARD, _meta(OPENING, CLOSING))
    _write_expected(xls, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=False)

    image = _render_image(STANDARD, _meta(OPENING, CLOSING))
    text_pdf = OUT / "statement_text.pdf"
    _write_text_pdf(text_pdf, STANDARD, _meta(OPENING, CLOSING))
    _write_expected(text_pdf, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=False)

    scanned = OUT / "statement_scanned.pdf"
    _write_scanned_pdf(scanned, image)
    _write_expected(scanned, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=True)

    photo = OUT / "statement_photo.png"
    # A flat capture with a margin. A skewed photo makes Tesseract flip a trailing
    # zero, which would fail the exact-amount check. Deskew still runs on the image.
    framed = Image.new("RGB", (image.width + 80, image.height + 80), "#d9d3c7")
    framed.paste(image, (40, 40))
    framed.save(photo, format="PNG")
    _write_expected(photo, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=True)

    locked = OUT / "statement_locked.pdf"
    _write_text_pdf(locked, STANDARD, _meta(OPENING, CLOSING), password=FIXTURE_PASSWORD)
    _write_expected(locked, STANDARD, _meta(OPENING, CLOSING), "northwind", None, expect_ocr=False, password=FIXTURE_PASSWORD)

    print(f"wrote fixtures to {OUT}")


def _meta(opening: int, closing: int, period: tuple[str, str] = PERIOD) -> dict:
    return {
        "opening_minor": opening,
        "closing_minor": closing,
        "period_start": period[0],
        "period_end": period[1],
        "currency": "AED",
    }


def _renumber(txns: list[Txn]) -> list[Txn]:
    return [
        Txn(index, txn.txn_date, txn.description, txn.debit_minor, txn.credit_minor, txn.balance_minor, txn.reference)
        for index, txn in enumerate(txns, start=1)
    ]


def _write_csv(path: Path, txns: list[Txn], headers: list[str], meta: dict, encoding: str) -> None:
    lines = [
        "Bank,Northwind Commercial Bank",
        f"Currency,{meta['currency']}",
        f"Period start,{meta['period_start']}",
        f"Period end,{meta['period_end']}",
        f"Opening,{fmt_amount(meta['opening_minor'])}",
        f"Closing,{fmt_amount(meta['closing_minor'])}",
        "",
        ",".join(headers),
    ]
    for txn in txns:
        lines.append(",".join(_cells(txn, headers)))
    data = ("\n".join(lines) + "\n").encode("cp1256" if encoding == "cp1256" else "utf-8")
    path.write_bytes(data)


def _cells(txn: Txn, headers: list[str]) -> list[str]:
    values = {
        "Date": txn.txn_date,
        "Description": txn.description,
        "Debit": fmt_amount(txn.debit_minor),
        "Credit": fmt_amount(txn.credit_minor),
        "Balance": fmt_amount(txn.balance_minor),
        "Reference": txn.reference,
        "Posting": txn.txn_date,
        "Narr": txn.description,
        "Outflow": fmt_amount(txn.debit_minor),
        "Inflow": fmt_amount(txn.credit_minor),
        "RunBal": fmt_amount(txn.balance_minor),
        "RefNo": txn.reference,
        "DATE": txn.txn_date,
        "DESCRIPTION": txn.description,
        "DEBIT": fmt_amount(txn.debit_minor),
        "CREDIT": fmt_amount(txn.credit_minor),
        "BALANCE": fmt_amount(txn.balance_minor),
        "REFERENCE": txn.reference,
    }
    return [values[header] for header in headers]


def _write_expected(path: Path, txns: list[Txn], meta: dict, bank: str, encoding: str | None, expect_ocr: bool, password: str | None = None) -> None:
    payload = {
        "bank": bank,
        "encoding": encoding,
        "expect_ocr": expect_ocr,
        "password": password,
        **meta,
        "transactions": [
            {
                "row_no": txn.row_no,
                "txn_date": txn.txn_date,
                "description": txn.description,
                "debit_minor": txn.debit_minor,
                "credit_minor": txn.credit_minor,
                "balance_minor": txn.balance_minor,
                "reference": txn.reference,
            }
            for txn in txns
        ],
    }
    path.with_suffix(path.suffix + ".expected.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _major(minor: int | None):
    if minor is None:
        return None
    if minor % 100 == 0:
        return minor // 100
    return f"{minor / 100:.2f}"


def _write_xlsx(path: Path, txns: list[Txn], meta: dict) -> None:
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Statement"
    sheet.append(["Northwind Commercial Bank"])
    sheet.append(["Account statement"])
    sheet.append([f"Period: {meta['period_start']} to {meta['period_end']}"])
    sheet.append([f"Opening balance: {fmt_grouped(meta['opening_minor'])}"])
    sheet.append([f"Closing balance: {fmt_grouped(meta['closing_minor'])}"])
    sheet.append([f"Currency: {meta['currency']}"])
    sheet.append([])
    sheet.append(STANDARD_HEADERS)
    for txn in txns:
        # Numeric amount cells exercise the spreadsheet float boundary.
        sheet.append(
            [
                txn.txn_date,
                txn.description,
                _major(txn.debit_minor),
                _major(txn.credit_minor),
                _major(txn.balance_minor),
                txn.reference,
            ]
        )
    workbook.save(path)


def _write_xls(path: Path, txns: list[Txn], meta: dict) -> None:
    import xlwt

    workbook = xlwt.Workbook()
    sheet = workbook.add_sheet("Statement")
    prelude = [
        "Northwind Commercial Bank",
        "Account statement",
        f"Period: {meta['period_start']} to {meta['period_end']}",
        f"Opening balance: {fmt_grouped(meta['opening_minor'])}",
        f"Closing balance: {fmt_grouped(meta['closing_minor'])}",
        f"Currency: {meta['currency']}",
        "",
    ]
    for index, line in enumerate(prelude):
        sheet.write(index, 0, line)
    for index, header in enumerate(STANDARD_HEADERS):
        sheet.write(len(prelude), index, header)
    for row_index, txn in enumerate(txns):
        values = [
            txn.txn_date,
            txn.description,
            "" if txn.debit_minor is None else _major(txn.debit_minor),
            "" if txn.credit_minor is None else _major(txn.credit_minor),
            _major(txn.balance_minor),
            txn.reference,
        ]
        for column, value in enumerate(values):
            sheet.write(len(prelude) + 1 + row_index, column, value)
    workbook.save(str(path))


def _render_image(txns: list[Txn], meta: dict) -> Image.Image:
    font = ImageFont.truetype(FONT, 36)
    width, line = 2000, 70
    height = 280 + line * (len(txns) + 2)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 30), "Northwind Commercial Bank", font=font, fill="black")
    draw.text((40, 100), f"Opening balance: {fmt_amount(meta['opening_minor'])}", font=font, fill="black")
    draw.text((40, 160), f"Closing balance: {fmt_amount(meta['closing_minor'])}", font=font, fill="black")
    columns = [("DATE", 40), ("DESCRIPTION", 340), ("DEBIT", 1100), ("CREDIT", 1360), ("BALANCE", 1620)]
    header_y = 250
    for label, x in columns:
        draw.text((x, header_y), label, font=font, fill="black")
    for index, txn in enumerate(txns):
        y = header_y + line * (index + 1)
        values = {
            "DATE": txn.txn_date,
            "DESCRIPTION": txn.description,
            "DEBIT": fmt_amount(txn.debit_minor),
            "CREDIT": fmt_amount(txn.credit_minor),
            "BALANCE": fmt_amount(txn.balance_minor),
        }
        for label, x in columns:
            draw.text((x, y), values[label], font=font, fill="black")
    return image


def _write_text_pdf(path: Path, txns: list[Txn], meta: dict, password: str | None = None) -> None:
    document = fitz.open()
    page = document.new_page(width=920, height=700)
    page.insert_text((36, 32), "Northwind Commercial Bank", fontsize=14, fontname="helv")
    page.insert_text((36, 54), f"Opening balance: {fmt_grouped(meta['opening_minor'])}", fontsize=11, fontname="helv")
    page.insert_text((36, 72), f"Closing balance: {fmt_grouped(meta['closing_minor'])}", fontsize=11, fontname="helv")
    page.insert_text((36, 90), f"Period: {meta['period_start']} to {meta['period_end']}", fontsize=11, fontname="helv")
    page.insert_text((36, 108), f"Currency: {meta['currency']}", fontsize=11, fontname="helv")
    columns = [("DATE", 36), ("DESCRIPTION", 150), ("DEBIT", 400), ("CREDIT", 510), ("BALANCE", 630), ("REFERENCE", 760)]
    header_y = 150
    for label, x in columns:
        page.insert_text((x, header_y), label, fontsize=11, fontname="helv")
    for index, txn in enumerate(txns):
        y = header_y + 28 * (index + 1)
        values = {
            "DATE": txn.txn_date,
            "DESCRIPTION": txn.description,
            "DEBIT": fmt_amount(txn.debit_minor),
            "CREDIT": fmt_amount(txn.credit_minor),
            "BALANCE": fmt_amount(txn.balance_minor),
            "REFERENCE": txn.reference,
        }
        for label, x in columns:
            page.insert_text((x, y), values[label], fontsize=11, fontname="helv")
    if password:
        buffer = io.BytesIO()
        document.save(
            buffer,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            user_pw=password,
            owner_pw=f"{password}-owner",
        )
        path.write_bytes(buffer.getvalue())
    else:
        document.save(path)
    document.close()


def _write_scanned_pdf(path: Path, image: Image.Image) -> None:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    document = fitz.open()
    page = document.new_page(width=image.width, height=image.height)
    page.insert_image(page.rect, stream=buffer.getvalue())
    document.save(path)
    document.close()


if __name__ == "__main__":
    main()
