# Fast local lab (no rebuild on every edit)

## What runs where

| Piece | Where | Rebuild needed? |
| --- | --- | --- |
| Postgres + MinIO | Docker (`npm run infra`) | No |
| Next.js web | Host (`npm run dev`) | No — hot reload |
| Python worker + OCR | Host (`npm run worker`) | No — restart worker if you change Python |
| Full Docker web+worker | `npm run stack:full` | Yes — slow; only for shipping an image |

Default OCR is **AWS Textract** (`OCR_PROVIDER=textract` + `AWS_*` in `.env`). For local Tesseract instead, set `OCR_PROVIDER=local` and `TESSERACT_CMD`.

## One-time setup

```powershell
copy .env.example .env
# Keep PORTAL_SECURITY_STATUS=FAIL until security review PASS (synthetic clients only).

npm install
cd worker
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -e .
cd ..
```

If Postgres was already initialized before later SQL files, apply any missing ones once (order matters):

```powershell
Get-Content -Raw db\24-general-clients.sql | docker compose exec -T postgres psql -U daftar -d daftar
Get-Content -Raw db\25-client-archive.sql | docker compose exec -T postgres psql -U daftar -d daftar
Get-Content -Raw db\26-client-access-rls-fix.sql | docker compose exec -T postgres psql -U daftar -d daftar
Get-Content -Raw db\27-retire-lab-shell.sql | docker compose exec -T postgres psql -U daftar -d daftar
Get-Content -Raw db\28-invoice-extract-jobs.sql | docker compose exec -T postgres psql -U daftar -d daftar
```

## Every day

```powershell
npm run infra          # postgres + minio only
npm run worker         # terminal 1 — OCR_PROVIDER from .env
npm run dev            # terminal 2 — http://127.0.0.1:43123
```

## Product flow (general)

1. Open the app → auto session as accountant  
2. **Home** → **Create a client** (name + fiscal year start + year) → 12 open months  
3. Switch to that client in the sidebar  
4. Upload bank statements / Inbox sales & purchases for any month  
5. Review extraction → post journals → reports  

To compare OCR quality: set `OCR_PROVIDER=local`, upload a file; then set `OCR_PROVIDER=textract`, restart worker, re-upload the same file.

## Real documents

- Prefer synthetic clients until security PASS. Do not commit real PDFs/TRNs/IBANs.
- Optional folder inventory (gitignored output): `npm run lab:folder -- --input ./lab-input --period 2026-Q2`

## Build a Docker image only when you want a portable demo

```powershell
npm run stack:full
```

That rebuilds web + worker images. Keep day-to-day work on `infra` + `dev` + `worker`.
