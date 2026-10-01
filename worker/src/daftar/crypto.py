"""IBAN encryption. The UI receives the masked value only."""

from __future__ import annotations

import hashlib
import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key(material: str) -> bytes:
    return hashlib.sha256(material.encode("utf-8")).digest()


def encrypt_iban(plain: str, key_material: str) -> bytes:
    aes = AESGCM(_key(key_material))
    iv = os.urandom(12)
    encrypted = aes.encrypt(iv, plain.encode("utf-8"), None)
    ciphertext, tag = encrypted[:-16], encrypted[-16:]
    return iv + tag + ciphertext


def decrypt_iban(blob: bytes, key_material: str) -> str:
    """Used by tests to prove the blob is reversible. The API never calls this."""
    iv, tag, ciphertext = blob[:12], blob[12:28], blob[28:]
    aes = AESGCM(_key(key_material))
    return aes.decrypt(iv, ciphertext + tag, None).decode("utf-8")


def mask_iban(plain: str) -> str:
    compact = re.sub(r"\s+", "", plain).upper()
    last4 = compact[-4:]
    prefix = compact[:2]
    return f"{prefix}** **** **** {last4}"
