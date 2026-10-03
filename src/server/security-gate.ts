import { createHmac, timingSafeEqual } from "node:crypto";

import type { PoolClient } from "pg";

import {
  allowRealClientData,
  MFA_COOKIE,
  MFA_TTL_SECONDS,
  mfaDemoCode,
  portalSecurityStatus,
  requireDownloadMfa,
} from "@/config/security";
import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";

function mfaSecret() {
  return process.env.MFA_HMAC_SECRET || process.env.IBAN_ENCRYPTION_KEY || "dev-only-mfa-secret";
}

export function signMfaToken(userId: string, expiresAtMs: number) {
  const payload = `${userId}.${expiresAtMs}`;
  const sig = createHmac("sha256", mfaSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyMfaToken(userId: string, token: string | undefined | null, now = Date.now()) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [uid, expRaw, sig] = parts;
  if (uid !== userId) return false;
  const expiresAtMs = Number(expRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < now) return false;
  const expected = signMfaToken(userId, expiresAtMs);
  const a = Buffer.from(expected);
  const b = Buffer.from(`${uid}.${expRaw}.${sig}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyMfaCode(code: string) {
  const expected = mfaDemoCode();
  const a = Buffer.from(String(code || "").trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issueMfaCookieValue(userId: string, now = Date.now()) {
  const expiresAtMs = now + MFA_TTL_SECONDS * 1000;
  return {
    value: signMfaToken(userId, expiresAtMs),
    expiresAtMs,
    maxAge: MFA_TTL_SECONDS,
  };
}

export async function assertSyntheticTenant(db: PoolClient, clientId: string) {
  if (allowRealClientData()) return;
  const row = await db.query(`SELECT is_synthetic FROM clients WHERE id = $1`, [clientId]);
  if (!row.rowCount) throw new LedgerError("client_not_found", "not_found");
  if (row.rows[0].is_synthetic === false) {
    throw new LedgerError("real_client_data_blocked", "forbidden");
  }
}

export async function assertSessionTenantAllowed(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    return { ok: true, portalSecurityStatus: portalSecurityStatus() };
  });
}

export function assertDownloadMfa(userId: string, mfaToken: string | undefined | null) {
  if (!requireDownloadMfa()) return;
  if (!verifyMfaToken(userId, mfaToken)) {
    throw new LedgerError("mfa_required", "forbidden");
  }
}

export function securityStatusPayload() {
  return {
    portalSecurityStatus: portalSecurityStatus(),
    allowRealClientData: allowRealClientData(),
    requireDownloadMfa: requireDownloadMfa(),
    reviewDoc: "docs/architecture/06-portal-security-review.md",
    note:
      portalSecurityStatus() === "PASS"
        ? "Security review PASS — real client onboarding may proceed under signed checklist."
        : "Security review FAIL — synthetic tenants only; pack downloads require step-up MFA.",
  };
}

export { MFA_COOKIE };
