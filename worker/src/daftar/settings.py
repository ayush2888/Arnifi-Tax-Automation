from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str
    database_url_super: str
    worker_database_url: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket: str
    s3_region: str
    iban_key: str
    ocr_provider: str
    worker_token: str
    pdf_probe_min_chars: int


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get(
            "DATABASE_URL",
            "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar",
        ),
        database_url_super=os.environ.get(
            "DATABASE_URL_SUPER",
            "postgresql://daftar:daftar-local-only@127.0.0.1:5432/daftar",
        ),
        worker_database_url=os.environ.get(
            "WORKER_DATABASE_URL",
            "postgresql://daftar_worker:daftar-local-only@127.0.0.1:5432/daftar",
        ),
        s3_endpoint=os.environ.get("S3_ENDPOINT", "http://127.0.0.1:59000"),
        s3_access_key=os.environ.get("S3_ACCESS_KEY", "daftar"),
        s3_secret_key=os.environ.get("S3_SECRET_KEY", "daftar-local-only"),
        s3_bucket=os.environ.get("S3_BUCKET", "statements"),
        s3_region=os.environ.get("S3_REGION", "us-east-1"),
        iban_key=os.environ.get("IBAN_ENCRYPTION_KEY", "dev-only-iban-key-change-me"),
        ocr_provider=os.environ.get("OCR_PROVIDER", "local"),
        worker_token=os.environ.get("WORKER_TOKEN", "dev-worker-token"),
        pdf_probe_min_chars=int(os.environ.get("PDF_PROBE_MIN_CHARS", "30")),
    )
