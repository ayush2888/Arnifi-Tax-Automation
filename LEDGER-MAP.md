# Ledger map

This repo is a copy of [accounting-automation-](https://github.com/rajs2151/accounting-automation-). Two notebooks are in the database. They do not copy each other.

## Notebooks

| Notebook | Tables | What reads it |
| --- | --- | --- |
| Real books | `journal_entries` in `db/04-ledger.sql` | VAT (`src/server/ledger.ts`, `src/server/release.ts`), reconcile (`src/server/recon.ts`), close (`src/server/close.ts`), profit and balance sheet (`src/server/statements.ts`), corporate tax (`src/server/ct.ts`) |
| Sidebar books | `books_journal_entries` in `db/16-books.sql` | `/books/*` only. That file says this ledger does not write `journal_*`. |

Demo company for the real books: Al Noor Trading LLC (`22222222-2222-4222-8222-222222222222`). The other notebook’s demo companies are Desert Falcon, Gulf Crest, and Palm Grove.

## Screens

| Screen | Route | Status |
| --- | --- | --- |
| Bank rows | `/transactions` | Real. Rows come from the worker. |
| Bank file upload | `/statements` | Real. This is the PDF, not the profit report. |
| Ledger | `/journals` | Real. Posts into `journal_*`. An unequal journal is rejected by the database. |
| VAT | `/vat201` | Real. Totals come from posted journals. A second person approves before download. |
| Reconcile | `/reconcile` | Real. |
| Close | `/close` | Real. A closed month rejects new journals. |
| Profit and balance sheet | `/reports` | Real. Cash flow on this page is the existing demo. |
| Corporate tax | `/ct` | Real. Starts from accounting profit. Download waits for a second person. |
| Books transactions | `/books/transactions` | Redirects to `/transactions`, the real bank grid. |
| Books ledger | `/books/journals` | Real for `books_*` only. Those rows do not change VAT or tax. |
| Books profit tabs | `/books/reports/trial-balance` | Trial balance is real for `books_*`. Profit and loss and the balance sheet link to `/reports`. Cash flow on that page is the demo. |
| Expenses | `/books/expenses` | Placeholder. |
| Company Health | `/books/health` | Placeholder. |

The menu in this repo opens the real routes above. Expenses and Company Health stay in the code and off the menu.
