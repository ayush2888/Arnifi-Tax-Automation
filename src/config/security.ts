/** Portal security review status. Default FAIL = synthetic tenants only. */
export type PortalSecurityStatus = "FAIL" | "PASS";

export function portalSecurityStatus(): PortalSecurityStatus {
  const raw = (process.env.PORTAL_SECURITY_STATUS || "FAIL").toUpperCase();
  return raw === "PASS" ? "PASS" : "FAIL";
}

export function allowRealClientData() {
  return portalSecurityStatus() === "PASS";
}

export function requireDownloadMfa() {
  const raw = (process.env.REQUIRE_DOWNLOAD_MFA || "true").toLowerCase();
  return raw !== "false" && raw !== "0";
}

/** Local/demo step-up code. Never use as production MFA. */
export function mfaDemoCode() {
  return process.env.MFA_DEMO_CODE || "000000";
}

export const MFA_COOKIE = "daftar_mfa";
export const MFA_TTL_SECONDS = Number(process.env.MFA_TTL_SECONDS || "300");
