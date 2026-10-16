/** Product name lives in one place so the shell, title, and exports stay in step. */
export const PRODUCT_NAME = "arnibooks";

export const PRODUCT_DESCRIPTION =
  "Arnifi ledger workspace for bookkeeping and VAT. This environment holds synthetic data only.";

/** Demo OPEN period seeded in db/05-ledger-seed.sql (legacy ledger). */
export const DEMO_PERIOD_ID = "a0000001-0000-4000-8000-000000000001";

export const DEMO_USER_ID = "55555555-5555-4555-8555-555555555555";

/** Default session client = Desert Falcon (books Phase 0 synthetic A). */
export const DEMO_CLIENT_ID = "e1000001-0000-4000-8000-000000000001";

/** Legacy ledger demo company. VAT, close, and tax for the walkthrough live on this client. */
export const AL_NOOR_CLIENT_ID = "22222222-2222-4222-8222-222222222222";

/** Books module company switcher — Phase 0 synthetics only (hide legacy Al Noor / Harbour). */
export const BOOKS_CLIENT_IDS = [
  "e1000001-0000-4000-8000-000000000001", // Desert Falcon Services FZE
  "e1000001-0000-4000-8000-000000000002", // Gulf Crest Trading LLC
  "e1000001-0000-4000-8000-000000000003", // Palm Grove Properties LLC
] as const;

export const BOOKS_CLIENT_ID_SET = new Set<string>(BOOKS_CLIENT_IDS);
