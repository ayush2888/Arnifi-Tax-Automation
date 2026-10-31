/** Product name lives in one place so the shell, title, and exports stay in step. */

export const PRODUCT_NAME = "arnibooks";

export const PRODUCT_DESCRIPTION =
  "Arnifi ledger workspace for bookkeeping and VAT. Synthetic clients only until portal security PASS.";

/** Session user (accountant role). Display name is hidden in UI. */
export const DEMO_USER_ID = "55555555-5555-4555-8555-555555555555";

/**
 * Local PDF lab tenant only (`db/23-alpha-ctrl-lab.sql` + `scripts/lab/*`).
 * Always archived / hidden from the company switcher — never a session default.
 */
export const LAB_CLIENT_ID = "c1000001-0000-4000-8000-00000000a001";

/** @deprecated Lab period id — do not use in product UI. */
export const LAB_PERIOD_ID = "c1000001-0000-4000-8000-00000000a101";

/** @deprecated Use LAB_CLIENT_ID. Kept so old imports do not break mid-refactor. */
export const DEMO_CLIENT_ID = LAB_CLIENT_ID;

/** @deprecated Use LAB_PERIOD_ID. */
export const DEMO_PERIOD_ID = LAB_PERIOD_ID;

/** Legacy ledger demo company (kept in DB for golden tests). */
export const AL_NOOR_CLIENT_ID = "22222222-2222-4222-8222-222222222222";

/** Books module Phase 0 synthetics (tests / goldens — not the accountant switcher). */
export const BOOKS_CLIENT_IDS = [
  "e1000001-0000-4000-8000-000000000001", // Desert Falcon Services FZE
  "e1000001-0000-4000-8000-000000000002", // Gulf Crest Trading LLC
  "e1000001-0000-4000-8000-000000000003", // Palm Grove Properties LLC
] as const;

export const BOOKS_CLIENT_ID_SET = new Set<string>(BOOKS_CLIENT_IDS);

const PIPELINE_DEMO_CLIENT_IDS = [
  "d1000001-0000-4000-8000-000000000001", // Sandstorm Services LLC
  "d1000001-0000-4000-8000-000000000002", // Caravan Trading LLC
  "d1000001-0000-4000-8000-000000000003", // Palm Realty LLC
] as const;

const HARBOUR_CAFE_CLIENT_ID = "33333333-3333-4333-8333-333333333333";

/**
 * Colleague / fixture seed tenants. Stay in the DB for tests and goldens,
 * but never appear in the accountant company switcher. Accountants create
 * their own companies (e.g. Alphacntrl) from Home.
 */
export const SEED_CLIENT_IDS_HIDDEN_FROM_SWITCHER = new Set<string>([
  LAB_CLIENT_ID,
  AL_NOOR_CLIENT_ID,
  HARBOUR_CAFE_CLIENT_ID,
  ...PIPELINE_DEMO_CLIENT_IDS,
  ...BOOKS_CLIENT_IDS,
]);

export function isSwitcherVisibleClient(clientId: string) {
  return Boolean(clientId) && !SEED_CLIENT_IDS_HIDDEN_FROM_SWITCHER.has(clientId);
}
