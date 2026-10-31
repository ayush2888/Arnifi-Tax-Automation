# Production phases (executable)

Goal: Arnifi accountant portal that is **production-credible**, not demo-only.
Defaults: real PDFs via **local gitignored lab** until security PASS; first milestone =
**upload → extract → review → post journals → VAT draft pack**.
Do not copy CrossVal or Tofu names, logos, colours, or exact marketing copy.
Layout/workflow inspiration only ([CrossVal bookkeeping](https://www.crossval.com/bookkeeping-software/), [Tofu](https://www.gotofu.com/)).

Say **code** (or continue) for one phase at a time.

## Phase 1 — App chrome (in progress)

- Arnifi theme tokens, CrossVal-style nav groups, Statements in sidebar
- General client create (any name) → fiscal-year months → upload any period (no hard-coded lab month copy)
- Remove dead language switcher; search only where wired
- Polished login + Ledger list/form cards
- Exit: accountant can create a client, upload, review, post without looking unfinished

## Phase 2 — Document review UX (Tofu-style)

- Review drawer: extracted fields + jump-to-source highlight on PDF/image
- Inbox queue: pending / needs review / posted
- Exit: accountant corrects one field and posts without leaving the drawer

## Phase 3 — Extraction hardening

- Bank PDF + tax invoice parsers; confidence scores; clear failures
- Default OCR = AWS Textract (`OCR_PROVIDER=textract`, needs AWS_* env)
- Optional local compare: `OCR_PROVIDER=local` (Tesseract eng+ara)
- Exit: synthetic fixtures + sample text PDFs extract with tests green; textract unit test with mocked boto3

## Phase 4 — Real-document lab (gitignored)

- `npm run lab:folder -- --input <dir>` inventories PDFs, runs extract, writes `lab-output/`
- Never commit real invoices, TRNs, or lab output
- Exit: May–Jul pack produces a machine-readable extract report + error list

## Phase 5 — Security → one pilot client

- Checklist in `docs/architecture/06-portal-security-review.md`
- Real login (replace demo switcher), MFA, isolation tests
- Only then `PORTAL_SECURITY_STATUS=PASS` for one consented pilot
- Exit: parallel VAT draft vs filed workings with difference log

## Out of scope until asked

WhatsApp ingest, FTA auto-submit, full multi-entity ERP, copying competitor branding.

## After MVP (peer backlog)

Home / practice ideas from Xero, Dext, Intuit, CrossVal, Tofu — do **not** build into MVP.
Saved in [`docs/post-mvp-peer-scope.md`](./post-mvp-peer-scope.md).
