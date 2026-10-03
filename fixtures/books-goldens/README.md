# Books goldens (hand-computed)

Expected outputs for synthetic books companies. Amounts are integer minor units (AED fils).

**Rule:** compute independently in a spreadsheet. Do not generate these files by dumping application output.

| Folder | Client | Period |
|---|---|---|
| `a/` | Desert Falcon Services FZE | 2026-Q2 |

## Company A Phase 1 TB assumptions

Seeded posted journals in `db/17-books-seed.sql`:

1. Opening: Dr Bank 1000 = 100000 / Cr Equity 3000 = 100000
2. Sale: Dr AR 1100 = 10500 / Cr Revenue 4000 = 10000 / Cr VAT output 2100 = 500
3. Expense: Dr Expense 5000 = 2000 / Cr Bank 1000 = 2000

Totals: debit 112500 = credit 112500.
