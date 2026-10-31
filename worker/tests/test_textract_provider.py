"""OCR_PROVIDER=textract maps DetectDocumentText WORD blocks to Token."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from PIL import Image

from daftar.extract import Token, recognize


def test_textract_provider_maps_word_blocks(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "textract")
    monkeypatch.setenv("AWS_REGION", "us-east-1")

    image = Image.new("RGB", (200, 100), color=(255, 255, 255))
    fake_response = {
        "Blocks": [
            {
                "BlockType": "WORD",
                "Text": "Hello",
                "Confidence": 99.5,
                "Geometry": {"BoundingBox": {"Left": 0.1, "Top": 0.2, "Width": 0.25, "Height": 0.1}},
            },
            {"BlockType": "LINE", "Text": "Hello world"},
            {
                "BlockType": "WORD",
                "Text": "world",
                "Confidence": 88.0,
                "Geometry": {"BoundingBox": {"Left": 0.4, "Top": 0.2, "Width": 0.3, "Height": 0.1}},
            },
        ]
    }

    client = MagicMock()
    client.detect_document_text.return_value = fake_response

    with patch("boto3.client", return_value=client) as boto_client:
        processed, tokens = recognize(image)

    boto_client.assert_called_once()
    assert processed.size == (200, 100)
    assert len(tokens) == 2
    assert tokens[0] == Token("Hello", 20.0, 20.0, 70.0, 30.0, 0.995)
    assert tokens[1].text == "world"
    assert tokens[1].confidence == 0.88
    client.detect_document_text.assert_called_once()
    args = client.detect_document_text.call_args.kwargs
    assert "Bytes" in args["Document"]
    assert isinstance(args["Document"]["Bytes"], (bytes, bytearray))
