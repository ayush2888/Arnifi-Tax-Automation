# Phase 1: Bank Statement Ingestion and Transactions Workspace

Paste this whole file into Cursor as the task brief. Attach the reference screenshots listed in section 9.

## 0. Working agreement (read first)

1. Before writing code, reply with a short implementation plan (files, order of work, risks). Wait for approval.
2. Work in small steps. After each step, run the tests and show the actual output. Do not claim something works without test output.
3. Never invent bank statement formats. Build the parser-profile mechanism (section 4) and test with fixtures.
4. Never use floats for money. Store integer minor units plus a currency code.
5. If a requirement is ambiguous, ask one question instead of guessing.
6. Anything not listed under "In scope" is out of scope. Do not add reconciliation, VAT, ledger or AI classification in this phase.

## 1. Goal

An accountant uploads a bank statement (CSV, Excel, text PDF, scanned PDF or image). The system detects the file type, extracts the transactions with the cheapest reliable method, validates them with arithmetic checks, and shows them in an Airtable/Notion-style table with a detail drawer. Every row traces back to its source page.

**In scope:** multi-tenant skeleton, statement upload, routing, parsers, OCR adapter, validation, transactions grid and drawer, rule-based categories, correction log, usage metering, export to CSV.
**Out of scope:** invoices and receipts, reconciliation, journals/ledger, VAT201, Tally export, LLM classification, bank feeds.

## 2. Stack (proposal, confirm in your plan)

- Web: Next.js (TypeScript), Tailwind with CSS-variable design tokens, TanStack Table + TanStack Virtual for the grid.
- Database: PostgreSQL with row-level security by `client_id`.
- Storage: S3-compatible (MinIO locally, S3 later).
- Ingestion worker: Python (pdfplumber or PyMuPDF for PDF text and word coordinates, pandas/openpyxl for CSV and Excel), job queue.
- OCR: provider interface with two adapters, selected by `OCR_PROVIDER`: `local` (Tesseract with Arabic and English models) and `textract` (AWS, added later, not wired in Phase 1).
- Local run: `docker compose up` starts Postgres, MinIO, web and worker.

## 3. Data model

All tables carry `created_at`. All client data tables carry `client_id`.

- `firms`, `clients` (name, trn nullable, default currency AED), `users` (role: admin, accountant, viewer), `user_client_access`.
- `bank_accounts`: client_id, bank_name, label, iban_encrypted, iban_masked, currency.
- `files`: client_id, sha256 (unique per client), original_name, detected_mime, size, storage_key, uploaded_by.
- `statements`: client_id, bank_account_id, file_id, period_start, period_end, opening_minor, closing_minor, currency, status (uploaded, parsing, parsed, needs_review, approved, failed), extraction_method (csv, xlsx, pdf_text, ocr, mixed), page_count, error.
- `parser_profiles`: bank_name, column_map (jsonb), date_format, decimal_separator, thousands_separator, encoding, version, confirmed_by.
- `bank_transactions`: client_id, statement_id, row_no, source_page, source_bbox (jsonb), txn_date, value_date, description_raw, description_clean, counterparty, reference, debit_minor, credit_minor, balance_minor, currency, txn_type, category_id, vat_code (nullable, unused), class_status (unclassified, proposed, confirmed), review_status (ok, needs_review, approved), flags (text[]), extraction_confidence, dedupe_hash.
- `categories` (firm default or client specific) and `rules` (match_type contains/regex/exact, pattern, category_id, version, active). Rules are deterministic and apply in priority order.
- `corrections`: bank_transaction_id, field, old_value, new_value, user_id, saved_as_rule.
- `audit_log`: entity, entity_id, action, actor, diff, at.
- `processing_events`: file_id, stage, method, pages, est_cost_usd, duration_ms. This is the usage meter. Every OCR page and every parse is logged.

## 4. Ingestion router (cheapest reliable method first)

1. **Hash.** Compute SHA-256. If the same client already uploaded this file, link to the existing statement and stop. No processing cost.
2. **Sniff the type** from content (magic bytes), not just the extension.
3. **Route:**
   - CSV/TSV: detect encoding (UTF-8, UTF-8 BOM, Windows-1256 for Arabic), delimiter, decimal and thousands separators, date format. Parse directly.
   - XLSX/XLS: find the header row (statements often have a title block above it), pick the right sheet, parse directly.
   - PDF: if encrypted, ask the user for the password (never store it). Otherwise probe each page for a text layer: enough characters, and date-like and amount-like tokens. Text pages use text and table extraction with word coordinates. Pages failing the probe go to OCR. A single PDF may mix both (`extraction_method = mixed`). Probe thresholds are configurable and must be tuned on real samples.
   - Images (JPG, PNG, HEIC, TIFF): preprocess (rotate, deskew), then OCR.
4. **Map columns.** Look up a `parser_profile` for the bank. If none exists, propose a column mapping and show a confirmation screen to the accountant. The confirmed mapping is saved as a new profile so the next statement from that bank needs no confirmation.
5. **Normalize** to the `bank_transactions` shape. Keep `description_raw` untouched. Support Arabic text and render with `dir="auto"`.
6. **Validate** (section 5). Failures set flags and `needs_review`. Never silently fix a number.
7. **Meter.** Write `processing_events` for every stage.

## 5. Validation rules (deterministic)

- Opening balance + total credits - total debits = closing balance.
- Running balance check on every row (balance[n] = balance[n-1] + credit - debit). The first row failing the chain is flagged, and so are all rows after it until the chain recovers.
- Dates parse, fall within the statement period, and are in order (or flagged).
- No row has both debit and credit populated, unless the bank format allows it.
- Row count extracted from the source matches rows stored.
- Duplicate rows across overlapping statements are detected with `dedupe_hash` (date, amounts, description, balance) and flagged, not deleted.
- OCR rows: a passing running-balance chain is the main confidence signal. Low-confidence OCR rows that break the chain are flagged for manual review.

## 6. UI

Left navigation: Dashboard, Statements, Transactions. Collapsible. Client switcher at the top.

**Dashboard:** cards for statements uploaded, transactions parsed, rows needing review, balance-check failures; recent statements list with status; upload dropzone.

**Statements:** table of statements (bank, period, method, status, opening, closing, balance check result). Click opens the statement drawer with file info, extraction method, per-stage events and the column-mapping confirmation when needed.

**Transactions (the core screen):** Airtable/Notion-style grid.
- First column is the reference ID, sticky; clicking it opens the right-hand drawer.
- Columns: reference, date, description, counterparty, debit, credit, balance, category (inline editable select), status, flags, confidence, statement.
- Amounts right-aligned, negative styling consistent, tabular numerals.
- Column resize, show/hide, reorder; saved views; filters (date, amount, category, status, flags); sort; group by month; bulk select with bulk categorize; keyboard navigation; virtualized rows (must stay smooth at 50,000 rows).
- Tabs with counts: All, Needs Review, Unclassified. Banner when rows need review.
- Two separate status indicators: classified, and (later) matched. Do not merge them.

**Drawer tabs:** Overview (editable fields), Source (the original page with the row highlighted using stored coordinates), Audit Log. Previous/next arrows. Deep link `?record=<id>`.

**Rules:** simple screen to list, create, disable rules. A correction offers "Save as rule"; saving a rule is always an explicit user action, never automatic.

## 7. Design tokens (placeholders until brand is supplied)

Define all colours, radii, spacing and fonts as CSS variables in one file. Use neutral placeholders:
`--brand-primary`, `--brand-primary-contrast`, `--brand-accent`, `--surface`, `--surface-muted`, `--border`, `--text`, `--text-muted`, `--status-ok`, `--status-warn`, `--status-error`, `--status-info`.
Product name comes from one config constant. Support light mode now, dark mode tokens defined but optional. Do not hard-code colours in components.

## 8. Security and data handling

- Row-level security on every client table. Include a test proving user A cannot read client B's rows.
- Encrypt IBANs at rest and show only masked values in the UI and logs. Never log statement contents.
- Uploaded files are private objects, accessed via short-lived signed URLs.
- Only synthetic or approved anonymised data in the repo and in dev databases.

## 9. Reference screenshots to attach

Attach as layout references only: (1) transactions list with the Unmatched tab and banner, (2) ledger journals list, (3) journal entry drawer, (4) expense drawer with Overview and Audit Timeline tabs. Do not copy branding, colours, icons or copy from them. Behaviour comes from this document, not from the screenshots. If a screenshot conflicts with this document, follow this document.

## 10. Test fixtures

Create a generator script producing synthetic statements in each format: CSV (UTF-8 and Windows-1256 with Arabic descriptions), XLSX with a title block above the header, a text PDF, a scanned PDF, a photo-style image, a password-protected PDF, and a pair of overlapping statements. Include planted errors: a broken running balance, a duplicate row, a wrong closing balance. Real anonymised statements are added later and must pass the same tests.

## 11. Acceptance criteria (show test output for each)

1. CSV, XLSX, text PDF, scanned PDF and image fixtures each produce the expected row count and amounts.
2. A text PDF never triggers OCR (verified through `processing_events`). A scanned PDF does.
3. The planted broken running balance flags exactly the expected rows.
4. A wrong closing balance sets the statement to `needs_review`.
5. Re-uploading the same file creates no new processing events.
6. Overlapping statements flag duplicate rows without deleting any.
7. Arabic descriptions round-trip correctly from file to database to UI.
8. Amounts are stored as integer minor units, with a test that rejects floats.
9. A confirmed column mapping is reused for the next statement from the same bank without asking again.
10. Row-level security test passes (cross-client reads are denied).
11. Every transaction opens a drawer showing its source page with the row highlighted.
12. The grid scrolls smoothly with 50,000 generated rows.
13. CSV export of the visible rows matches the on-screen values.
14. Saving a correction writes to `corrections` and `audit_log`; saving a rule requires an explicit click.
