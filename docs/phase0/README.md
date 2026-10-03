# Phase 0 approval screenshots

Captured by `e2e/books-phase0-screenshots.spec.ts` against compose `web`.

| File | What to review |
|------|----------------|
| `create-entry-empty.png` | Empty Create Entry; grey footer `Dr 0.00 · Cr 0.00`; column widths |
| `create-entry-vat-balanced.png` | VAT sale with auto Output VAT line showing **2210**, editable/removable |
| `create-entry-unbalanced.png` | Red out-of-balance footer |
| `ledger-full-width.png` / `journals-datagrid.png` | Full-width grid; Tags + Status visible; `SCH-`/`DRAFT-`/`JE-` refs (no `e4000001`); Tax chip only on 1430/2210 |
| `settings-coa.png` | Statement line human labels; row ⋯ menu |
| `trial-balance-net.png` | Net TB; hover 2210 row for VAT note tooltip |
| `trial-balance-movements.png` | Movements columns |
| `ledger-filters.png`, `manage-tags.png`, `ledger-bulk-bar.png` | Toolbar |
| `home.png` | Books home |

## Accounting notes (Company A)

- **Rent 6200 = 160.00 AED** in TB comes from **posted** May rent (80) + **schedule_post** of June rent (80). Draft/scheduled are excluded from TB.
- **1430 Input VAT** appears from the fixed Office expense seed (net + 5% input VAT).
- **2210** tooltip: period Debit includes reversal of duplicate sale; settlement posting nets output VAT.
