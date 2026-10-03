# arnibooks

Arnifi ledger workspace for bookkeeping and VAT (built on the Daftar bank-statement core). Stage A adds an in-repo double-entry ledger, synthetic document → posting, and a draft VAT201 report from the ledger. Dual-control release and client download are Stage B — see [docs/architecture/01-plan-critique-and-roadmap.md](docs/architecture/01-plan-critique-and-roadmap.md).

An accountant can still upload a bank statement; the worker extracts rows with the cheapest reliable method, and the grid links each transaction to its source page.

This repository holds synthetic data only. Real statements, PDF passwords, and production credentials do not belong here.

## Run locally

GitHub stores the code and runs the acceptance tests. It does not host the app. The app needs Postgres, private file storage, and a background worker.

Docker Compose starts Postgres, MinIO, the web app, and the worker:

```bash
docker compose up --build
```

The web app listens on port **43123**: [http://127.0.0.1:43123](http://127.0.0.1:43123). The demo user is Omar Faris, working on Al Noor Trading LLC. Switch user and client from the sidebar. Nina Shah can only see Harbour Cafe LLC.

The first statement for a bank asks you to confirm the column map. The next statement from that bank reuses it.

Copy `.env.example` to `.env` only if you run the processes outside Compose. The values in that file are local placeholders.

## Layout

- `src/` Next.js app and the API the grid calls
- `worker/` Python ingestion worker
- `db/` Postgres schema (incl. `04-ledger.sql` / `05-ledger-seed.sql`), RLS, and the synthetic firm
- `fixtures/` generator for synthetic statements (output is gitignored)
- `.github/workflows/acceptance.yml` runs the acceptance tests on every push

### Stage A exit checklist

- Demo client (Al Noor) has an OPEN period and UAE starter COA
- Unbalanced journals cannot post (app + DB deferred trigger)
- Synthetic sales/purchase fixtures in **Inbox** become source-linked posted journals
- **VAT draft** page shows boxes reproducible from the ledger for that period
- Existing bank-statement acceptance tests still pass

### Stage B exit checklist

- Omar prepares a VAT201 pack; Layla (different user) approves and releases
- Preparer cannot approve their own pack (enforced for the first 90 days)
- Posting a new journal in the period marks the released pack `STALE` and blocks download
- Download of a `RELEASED` pack shows status/version/date and appends to the download log
- Product never submits to the FTA

### Stage C exit checklist

- Posted sales/purchase invoices create AR/AP open items
- Bank ↔ open-item matches (incl. exact auto-propose) confirm and post settlement journals
- Control check: AR/AP sub-ledger equals control within tolerance
- Exception queue can flag and resolve control breaks / unmatched rows

### Stage D1 exit checklist

- Accruals and depreciation can be proposed/posted (or waived) for a period
- Close checklist requires TB identity (+ recon/VAT settled or waived)
- `CLOSED` periods reject new journal posts until reopen with reason/ticket
- Reopen audits and marks VAT packs `STALE`

### Stage D2 exit checklist

- P&L / balance sheet / demo CF built from the ledger for a period
- Integrity gates: TB balanced, A=L+E, RE roll-forward — block STATEMENTS prepare/release when failed
- Year-end close posts P&L into retained earnings and keeps RE roll-forward identity
- Dual-control STATEMENTS pack release (preparer ≠ approver)

### Stage E exit checklist

- CT report starts from ledger accounting profit and keeps an adjustments trail
- CT payable reconciles to that ledger profit (+/− adjustments)
- Download only after dual-control `RELEASED` CT pack (approve-before-download)
- Product never submits CT to the FTA

Fresh Compose volumes pick up `db/0N-*.sql` automatically. Existing volumes need a recreate (`docker compose down -v` then `up --build`) or a manual `psql` apply of `04`–`11` SQL files.

## Money, tenants, and files

Amounts are integer minor units at a scale of 2 (hundredths of the major unit). That matches AED fils. A fractional JSON number is rejected. `1.23` is 123 minor units. `1.230` is rejected: the trailing zero is a third decimal place, and it is not trimmed to `1.23`. Kuwaiti dinar, Bahraini dinar, and Omani rial (KWD, BHD, OMR) are quoted to three decimal places. Upload rejects those statements with `unsupported_currency` before the file is stored. The Phase 2 design is in [docs/currency-exponents.md](docs/currency-exponents.md).

Each request sets `app.current_user_id`. Row-level security hides other clients. IBANs are encrypted; the interface shows the mask. Uploaded files are private objects. The browser receives a signed URL that expires in five minutes. A PDF password is sent to the worker for the unlock request and is not stored.

## Tests

Python:

```bash
python -m pip install -e "./worker[dev]"
cd worker && pytest -q
```

Node:

```bash
npm test
```

Playwright (needs Postgres and the object store on port 59000; the browser grid uses port 43127):

```bash
npx playwright test
```

`npx playwright test` opens the transactions grid in Chromium, scrolls 50,000 rows, records the time, and saves a screenshot of the source highlight. It uses the `daftar_e2e` database and the local object store on port 59000.

Python covers parsing, OCR routing, balance checks, duplicates, Arabic round-trip, column-map reuse, and cross-client access. Node covers money formatting, the 50,000-row window, source-highlight geometry, corrections versus an explicit rule, and CSV export using the same amount strings as the screen.

## Secrets

`.gitignore` excludes `.env` files and `fixtures/generated`. `.gitleaks.toml` is the secret scanner. Point Git at the hook:

```bash
git config core.hooksPath .githooks
```

Install [gitleaks](https://github.com/gitleaks/gitleaks) so the hook can fail a commit. GitHub's own secret scanning, when the plan includes it, is an extra check on the remote. It does not replace keeping credentials out of the tree. Deployed credentials belong in the host environment (later, AWS Secrets Manager).

## Later

Staging on AWS — account, region, and a budget cap — is still open. Raise it before any deployment work. Phase 1 does not deploy.
