# Phase 0 → later carry-over

Items still deferred after the Phase 0 UI + COA rebuild and pre–Phase 1 alignment. Do **not** start Phase 2
Transactions until shared grid/drawer patterns are solid.

| Item | Status | Target phase | Notes |
|------|--------|--------------|--------|
| Saved views | **Done** (`books_saved_views`) | — | Personal/shared filter configs on Ledger. |
| Filter drawer | **Done** | — | Date, accounts, amount, actors, tags, attachment. |
| Manage tags | **Done** (`books_tags`) | — | Create/rename/recolour/merge/delete + usage. |
| Schedule / recurring / auto-reverse | **Done** (`books_jobs` + worker) | — | Worker kinds: `schedule_post`, `recurring_materialize`, `auto_reverse`. |
| Attachments on Create Entry | **Done** (MinIO + `books_journal_attachments`) | — | Upload + preview list on Create Entry. |
| Monthly periods + voucher series + edit model | **Done** (pre–Phase 1 / `db/22`) | — | Zoho/Xero draft edit; posted meta edit; reverse+correct; dual-control. |
| Linked documents in drawer | Stub / light | **Phase 1** | Richer Overview attachments UX; reused by Transactions. |
| Control-account sub-ledgers | Headers non-postable; controls still postable | **Phase 1+** | Reject manual lines on `is_control` once AR/AP sub-ledgers exist. |
| Company B/C TB goldens | Owner TODO | **Phase 1** | Hand-computed expected TB under COA v2. |
| Day Book, Ageing, Journal Report, Audit Trail screens | Backlog (names in MASTER CONTEXT) | **Phase 3+** | Match Zoho/Tally report names. |
| P&L / BS / CF (IFRS FS pack; Classic optional) | Tabs disabled | **Phase 6** | Tooltip: “Available in Phase 6”. |
| Real email invite | Stub in Settings | **Phase 1+** | Invite UI present; delivery later. |
| Transactions tab | Empty: “Coming in Phase 2” | **Phase 2** | Bank/card match to journals. |

## Ordering constraint

```
Phase 0 (UI + COA v2) → pre–Phase 1 alignment → Phase 1 (polish + B/C goldens + drawer docs) → Phase 2 (Transactions)
```
