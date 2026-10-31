# Post-MVP scope (from peer products)

**When:** after MVP is working — upload → extract → review → post journals → VAT draft.
**Why this file:** capture Home / practice ideas from peer websites so we do not rebuild them into the MVP.
**Rule:** inspire layout and workflow only. Never copy CrossVal, Tofu, Xero, Dext, or Intuit names, logos, colours, or marketing copy.

Peers checked (product homes / practice dashboards, not marketing landings):

| Peer | What their Home / practice UI emphasises |
| --- | --- |
| [Xero Partner Hub](https://www.xero.com/au/accountants-bookkeepers/partner-hub/) | Attention widgets, bank-feed alerts, jobs overdue / due soon, quick actions, customise homepage |
| [Xero org homepage](https://brandfolder.xero.com/) (Tasks widget pattern) | Unreconciled bank, overdue invoices, bills awaiting approval |
| [Dext Insights](https://dext.com/en/partner/products/insights-dashboard) | “Problems surface first”; To review / Ready queues; practice-wide bookkeeping status |
| [Intuit Accountant Suite](https://quickbooks.intuit.com/accountants/intuit-accountant-suite/) | Per-user Home: urgent tasks, reminders, bank-connection alerts |
| [CrossVal](https://www.crossval.com/) (MENA) | Month-end checklist + live P&L / board-pack (more SME-facing than practice desk) |
| [Tofu](https://www.gotofu.com/) | Marketing site ≠ product Home; workflow still upload → extract → review → post |

---

## MVP Home (do now / soon — keep thin)

Accountant desk for **one selected client + month** (top bar):

1. **Needs attention** — inbox to review, bank statements stuck, draft journals, unmatched recon, close blockers  
2. **Period health chips** — bank / docs / recon / VAT flags / period lock (no fake “TB balanced” at zero posts)  
3. **2 primary CTAs** — e.g. Review inbox (N), Open bank statements (N)  
4. **Setup buried** — create client / ensure months under Settings or first-run empty state only  

Do **not** ship long “how books work” tutorials or duplicate step cards on Home once the user has a client.

---

## Later — peer-inspired backlog (after MVP)

Rough priority. Revisit when MVP exit criteria pass.

### A. Practice-wide Home (Xero Partner Hub / Dext Insights)

- Firm glance: all clients with open months behind, stuck review, or overdue close  
- Client watchlist / favourites on Home  
- Bank / feed (or statement) alerts across clients before opening a file  
- Workload hint: which clients have the most “to review” items  

### B. Richer attention & tasks (Xero Tasks / Intuit Home)

- Customisable Home widgets (show / hide / reorder)  
- Task types: unreconciled lines, bills awaiting approval, dual-control post/reverse waiting on approver  
- Due / overdue colour for period close and VAT return windows (UAE FTA calendar)  

### C. Document review UX (Tofu / Dext Prepare)

- Review drawer: field + jump-to-source highlight on PDF  
- Inbox tabs: To review / Ready / Posted  
- Duplicate detection before post  
- Confidence scores and clear extract failures  

### D. Month-end & compliance (CrossVal checklist + our close module)

- Visible month-end checklist on Home (bank uploaded → matched → journals posted → reports)  
- VAT readiness strip (input VAT without supplier TRN, reverse charge flags)  
- CT pack readiness for the fiscal year (after VAT path is solid)  

### E. Insights / reporting on Home (defer deep FS)

- Light cash / spend chips only if journal-backed (no forecast mixing into actuals)  
- P&L / Balance Sheet / Cash Flow UI tabs stay Phase 6 (“Available in Phase 6”)  
- Do not put board-pack marketing dashboards on accountant Home until journals are trustworthy  

### F. Learning & rules (Tofu “teach it” / Dext coding memory)

- Remember coding / VAT treatment per supplier per client  
- Plain-language posting exceptions (audited)  
- Never train external LLMs on client docs (local OCR / approved providers only; security gate stays)  

### G. Ingestion channels (post-MVP convenience)

- Email / shared-folder drop (Dropbox, Drive, SharePoint-style)  
- WhatsApp-style receipt intake — only if policy + security PASS; synthetic first  

---

## Explicit non-goals for MVP

- Competitor marketing copy, testimonials, or “cut bookkeeping 75%” style Home  
- Full practice job manager / time billing (Xero Practice Management depth)  
- Customisable drag-and-drop widget marketplace  
- Live investor board pack as the accountant landing page  

---

## How to use this later

1. Confirm MVP exit (see `docs/production-phases.md`).  
2. Pick one letter block (A–G) and write a thin phase plan (SQL / API / UI / tests).  
3. Say **go** before coding that phase.
