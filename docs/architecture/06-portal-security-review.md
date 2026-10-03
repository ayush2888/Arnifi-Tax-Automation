# 06 — Portal security review (hard data gate)

**Purpose:** Written criteria for allowing real client data, portal client users, and Drive sync. Until status = **PASS**, the product must refuse non-synthetic tenants.

**Current review status:** `FAIL` (enforced by `PORTAL_SECURITY_STATUS`, default `FAIL`).

Filing stays outside the product: arnibooks never submits to the FTA. Pack download remains approve-before-download with audit.

## 1. Scope

| In scope | Out of scope (later) |
|---|---|
| Tenant isolation / RLS | Full IdP SSO |
| Role matrix (admin / accountant / viewer / portal_client) | Hardware keys |
| Download gating + step-up MFA (demo) | Production SMS/email OTP vendor |
| STRIDE on portal + pack download | Penetration test report |
| Synthetic-only hard gate | Real MFA enrollment UX polish |

## 2. STRIDE (portal + pack download)

| Threat | Example | Mitigation in arnibooks |
|---|---|---|
| **S**poofing | Stolen session cookie used as another user | HttpOnly cookies; short-lived download MFA cookie; session switcher is demo-only and blocked for non-synthetic when status ≠ PASS |
| **T**ampering | Altered pack JSON after approval | `content_hash` on release packs; hash re-checked on approve; upstream mutation → `STALE` |
| **R**epudiation | “I never downloaded that pack” | Append-only `download_events` with user + time + ip hash |
| **I**nformation disclosure | Cross-tenant leakage | Postgres RLS + `visible_client_ids()`; FORCE RLS; app roles without BYPASSRLS |
| **D**enial of service | Flood downloads / uploads | Size limits on upload; download requires RELEASED + MFA (rate limits later) |
| **E**levation of privilege | Viewer releases VAT/CT | RLS insert/update limited to admin/accountant; dual-control preparer ≠ approver |

## 3. Role matrix (minimum)

| Capability | admin | accountant | viewer | portal_client (future) |
|---|---|---|---|---|
| Switch demo session | ✓ | ✓ | ✓ | ✗ |
| Post journals / approve docs | ✓ | ✓ | ✗ | ✗ |
| Prepare release packs | ✓ | ✓ | ✗ | ✗ |
| Approve release packs | ✓ (≠ preparer) | ✓ (≠ preparer) | ✗ | ✗ |
| Download RELEASED packs | ✓ + MFA | ✓ + MFA | ✗ | ✓ + MFA (after PASS) |
| Mark client non-synthetic | ✓ only when status=PASS | ✗ | ✗ | ✗ |

## 4. Pass criteria checklist

Mark each item when evidenced. **All required items must be ✓ for status PASS.**

| # | Criterion | Required | Evidence |
|---|---|---|---|
| 1 | RLS FORCE on tenant tables; app roles cannot BYPASSRLS | ✓ | `db/01-schema.sql`, ledger/recon/close SQL |
| 2 | Dual-control release for VAT/STATEMENTS/CT (preparer ≠ approver, 90 days) | ✓ | Stage B/D2/E tests |
| 3 | Download only when pack `RELEASED`; audit row written | ✓ | `download_events` |
| 4 | Download step-up MFA (demo code / future TOTP) | ✓ | `src/server/security-gate.ts` |
| 5 | Non-synthetic clients blocked while status ≠ PASS | ✓ | `assertSyntheticTenant` |
| 6 | No FTA submit paths in codebase | ✓ | Architecture + API surface |
| 7 | Secrets not in git; `.env.example` placeholders only | ✓ | `.gitignore`, `.env.example` |
| 8 | Independent reviewer sign-off (name + date) | ✓ | _Pending — leave FAIL until signed_ |
| 9 | External pen-test or equivalent (optional for pilot) | ○ | — |

**Reviewer sign-off**

- Name: __________________
- Date: __________________
- Decision: FAIL / PASS
- Notes: __________________

## 5. Operating the gate

```bash
# Local / CI (synthetic only) — default
PORTAL_SECURITY_STATUS=FAIL
MFA_DEMO_CODE=000000
REQUIRE_DOWNLOAD_MFA=true

# Only after this document is signed PASS:
PORTAL_SECURITY_STATUS=PASS
```

When `FAIL`, the API refuses to mark clients `is_synthetic=false` and refuses work on non-synthetic tenants. When `PASS`, real client onboarding may proceed under the signed checklist.
