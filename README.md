# Daftar

Bank-statement workspace for an accounting firm. An accountant uploads a statement, the worker extracts the rows with the cheapest reliable method, and the grid shows every transaction with a link back to its source page.

This repository holds synthetic data only. Real statements, PDF passwords, and production credentials do not belong here.

## What runs where

GitHub stores the code and runs the acceptance tests. It does not host the app. The app needs Postgres, private file storage, and a background worker.

On your machine, Docker Compose starts Postgres, MinIO, the web app, and the worker:

```bash
docker compose up --build
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). The demo user is Omar Faris, working on Al Noor Trading LLC. Switch user and client from the sidebar. Nina Shah can only see Harbour Cafe LLC.

The first statement for a bank asks you to confirm the column map. The next statement from that bank reuses it.

Copy `.env.example` to `.env` only if you run the processes outside Compose. The values in that file are local placeholders.

## Layout

- `src/` Next.js app and the API the grid calls
- `worker/` Python ingestion worker
- `db/` Postgres schema, row-level security, and the synthetic firm
- `fixtures/` generator for synthetic statements (output is gitignored)
- `.github/workflows/acceptance.yml` runs the acceptance tests on every push

## Money, tenants, and files

Amounts are integer fils plus a currency code. A fractional number is rejected.

Each request sets `app.current_user_id`. Row-level security hides other clients. IBANs are encrypted; the interface shows the mask. Uploaded files are private objects. The browser receives a signed URL that expires in five minutes. A PDF password is sent to the worker for the unlock request and is not stored.

## Tests

```bash
python -m pip install -e "./worker[dev]"
cd worker && pytest -q
npm test
```

Python covers parsing, OCR routing, balance checks, duplicates, Arabic round-trip, column-map reuse, and cross-client access. Node covers money formatting, the 50,000-row window, source-highlight geometry, corrections versus an explicit rule, and CSV export using the same amount strings as the screen.

## Secrets

`.gitignore` excludes `.env` files and `fixtures/generated`. `.gitleaks.toml` is the secret scanner. Point Git at the hook:

```bash
git config core.hooksPath .githooks
```

Install [gitleaks](https://github.com/gitleaks/gitleaks) so the hook can fail a commit. GitHub's own secret scanning, when the plan includes it, is an extra check on the remote. It does not replace keeping credentials out of the tree. Deployed credentials belong in the host environment (later, AWS Secrets Manager).

## Later

Staging on AWS — account, region, and a budget cap — is still open. Raise it before any deployment work. Phase 1 does not deploy.
