# Subsidiary ledgers

Party-level ledgers built from posted journal lines. No separate sub-ledger tables: a ledger is the
set of journal lines on certain accounts, grouped by `books_journal_lines.party_id`.

| Ledger | Accounts included | Normal side | Party type |
| --- | --- | --- | --- |
| Sales | `is_ar` accounts | debit | customer |
| Purchase | `is_ap` accounts | credit | supplier |
| Loans | `sub_type = 'loan'` | credit | lender |
| Advances | `sub_type = 'advance'` | debit | employee |
| Capital | `sub_type IN ('capital','owner')` | credit | shareholder |

## Pieces

- `db/30-subsidiary-ledgers.sql`: `books_parties` (RLS, unique per client/name/type) and `party_id` on journal lines.
  Docker Compose applies it on a fresh volume; on an existing database run it once with `psql`.
- `src/server/books/subsidiary-ledger-core.ts`: pure logic (statements, summaries, aging, group totals, CSV, party validation).
- `src/server/books/subsidiary-ledgers.ts`: database service (parties, summary, statement, aging, group overview).
- API (`/api/books/...`): `GET parties`, `POST parties`, `PATCH parties/:id`, `GET subsidiary-ledger`
  (`kind`, `periodId`, optional `partyId`, `view=aging`, `includeZero`, `format=csv`), `GET group-ledgers?asOf=`.
- UI: Books > Subsidiary ledgers (balances, aging, party statement, CSV) and Group overview. The journal
  entry sheet has a Party column on each line.

## Rules worth knowing

- Reversals copy `party_id`, so a reversed receipt restores the customer balance.
- A party must belong to the same client as the journal. Deactivating a party hides it from pickers but keeps its history.
- Lines with no party show as "Unassigned" so the ledger total still ties to the trial balance for those accounts.
- Aging clears the oldest charges first; leftover receipts show as "Unapplied".
- The group overview sums amounts as stored, so it is only meaningful for companies reporting in the same currency.

## Not built yet

Multi-currency group consolidation, fixed-asset register, budgets, approval workflows beyond the existing
preparer/approver rule, and a party management screen (edit and deactivate work through the API).
