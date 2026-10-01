from __future__ import annotations

import io
from urllib.parse import urlparse

from minio import Minio

from daftar.settings import Settings


class ObjectStore:
    def __init__(self, settings: Settings):
        parsed = urlparse(settings.s3_endpoint)
        self.client = Minio(
            parsed.netloc,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            secure=parsed.scheme == "https",
        )
        self.bucket = settings.s3_bucket

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def put(self, key: str, content: bytes, content_type: str) -> None:
        self.client.put_object(
            self.bucket,
            key,
            io.BytesIO(content),
            length=len(content),
            content_type=content_type,
        )

    def get(self, key: str) -> bytes:
        response = self.client.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
