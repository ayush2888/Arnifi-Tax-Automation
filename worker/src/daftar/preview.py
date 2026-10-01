"""Render a page image so every transaction, including CSV rows, has a highlight box."""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFont

from daftar.mapping import FIELDS


FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def render_table_png(headers: list[str], rows: list[dict]) -> tuple[bytes, list[dict], int, int]:
    font = ImageFont.truetype(FONT_PATH, 22)
    small = ImageFont.truetype(FONT_PATH, 18)
    columns = [header for header in headers if header] or ["Description"]
    col_width = 220
    width = max(900, 40 + col_width * len(columns))
    row_height = 36
    height = 70 + row_height * (len(rows) + 1)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((20, 16), "Statement preview", font=small, fill="black")
    header_top = 52
    for index, header in enumerate(columns):
        draw.text((20 + index * col_width, header_top), header[:24], font=font, fill="black")
    boxes: list[dict] = []
    for row_index, row in enumerate(rows):
        top = header_top + row_height * (row_index + 1)
        cells = row.get("cells") or {}
        for index, header in enumerate(columns):
            draw.text((20 + index * col_width, top), str(cells.get(header, ""))[:24], font=font, fill="black")
        boxes.append(
            {
                "row_no": row.get("row_no"),
                "bbox": {
                    "x": 12,
                    "y": top - 4,
                    "width": width - 24,
                    "height": row_height,
                    "pageWidth": width,
                    "pageHeight": height,
                },
            }
        )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue(), boxes, width, height


def union_bbox(tokens, page_width: int, page_height: int) -> dict | None:
    if not tokens:
        return None
    x0 = min(token.x0 for token in tokens)
    y0 = min(token.y0 for token in tokens)
    x1 = max(token.x1 for token in tokens)
    y1 = max(token.y1 for token in tokens)
    pad = 3
    return {
        "x": max(0, int(x0) - pad),
        "y": max(0, int(y0) - pad),
        "width": max(1, int(x1 - x0) + pad * 2),
        "height": max(1, int(y1 - y0) + pad * 2),
        "pageWidth": page_width,
        "pageHeight": page_height,
    }


# Imported so a typo in the preview column set fails loudly during review.
_ = FIELDS
