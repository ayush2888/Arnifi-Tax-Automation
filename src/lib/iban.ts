import { createCipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const material = process.env.IBAN_ENCRYPTION_KEY;
  if (!material) throw new Error("IBAN_ENCRYPTION_KEY is required");
  return createHash("sha256").update(material).digest();
}

/** AES-256-GCM. Layout matches the worker: 12 byte iv, 16 byte tag, ciphertext. */
export function encryptIban(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function maskIban(plain: string) {
  const compact = plain.replace(/\s+/g, "").toUpperCase();
  return `${compact.slice(0, 2)}** **** **** ${compact.slice(-4)}`;
}
