# 01 — Plan critique and roadmap (arnibooks)

**Retrieval date for all web citations in this document: 2026-10-03.**  
**Sensitive data policy:** synthetic fixtures only until the owner confirms; no files leave the machine.

## 1. Summary

The prior UI-first roadmap (re-skin Daftar, then broaden automation) is mis-sequenced for a product that must be the **system of record**. arnibooks needs a minimal double-entry ledger and one thin vertical slice before cosmetic IA breadth. This document re-sequences work into **stages A → B → C → D1 → D2 → E**, adds a **3-stage validation protocol**, a **buy / build / integrate** comparison, person-week ranges, kill criteria, and a hard gate that **no real client data enters before the portal security review passes**. Filing stays outside the product: client or Arnifi accountant files in the FTA portal; arnibooks never submits. Release requires distinct preparer and approver for the first 90 days.

## 2. Options table

| Decision | Options considered | Trade-offs | Cost (relative) | Reversibility | What would change the decision |
|---|---|---|---|---|---|
| Sequencing | (1) UI re-skin first (old plan) (2) Ledger + thin slice first (3) Full VAT engine before ledger | (1) Pretty shell on non-SoR data (2) Delayed polish, correct core (3) VAT without postings is spreadsheet 2.0 | (2) highest early eng; (1) lowest early eng, highest rewrite risk | Medium for (2); Low for (1) after client portal ships | Proof that Arnifi will only ever prep exports into another ledger (rejected by scope) |
| Ledger strategy | Buy SaaS · Adopt OSS core · Build in-repo · Integrate competitor | See §3 buy/build/integrate | See §4 | Build highest control; buy lowest control | Licence counsel blocks GPL/AGPL SaaS wrapping; or pilot shows OSS cut time ≥40% |
| Validation | Lab-only · Back-test → shadow → pilot · Big-bang cut-over | Big-bang destroys trust; staged proves ROI | Staged adds calendar time | High | Missing filed golden returns blocks back-test |

## 3. Recommendation (confidence: **high** on sequencing; **medium** on build-vs-adopt)

**Recommend: Stage A ledger + thin slice first; build a purpose-built ledger core in this Postgres codebase (not wrap a GPL/AGPL ERP as the product).** Keep Arnifi-branded shell work as a thin parallel track that does not gate Stage A. Defer competitor feature breadth until A and B exit.

### 3.1 Critique of the prior phased plan

| Aspect | Assessment |
|---|---|
| Sound | Human approval gates; UAE/ME wedge; step-by-step not big-bang; reuse Next/Postgres/MinIO/worker bones |
| Missing | SoR ledger; opening/cut-over; integrity identities; portal security before real data; validation protocol; dual-control release; Drive/ERP intake (deferred to docs 03/05) |
| Mis-sequenced | Phase 0 “re-skin everything” before domain/integration; recon and VAT before balanced postings exist |

### 3.2 Buy vs build vs integrate

| Path | Examples | Licence / constraint (cited) | Fit for arnibooks SoR | Verdict |
|---|---|---|---|---|
| **Buy / partner** | Xero, QuickBooks Online, Zoho Books, CrossVal-class platforms | Vendor ToS; multi-tenant practice API limits **UNVERIFIED** without pricing call | Hard to own VAT pack + UAE portal UX; lock-in | Reject as SoR; optional later export adapter only |
| **Adopt OSS ledger** | Apache Fineract (Apache-2.0) — [fineract.apache.org](https://fineract.apache.org/), [github.com/apache/fineract](https://github.com/apache/fineract) licence Apache-2.0; LedgerSMB (GPLv2) — [ledgersmb.org/faq](https://ledgersmb.org/faq); ERPNext (GPLv3) — [github.com/frappe/erpnext](https://github.com/frappe/erpnext); Bigcapital (AGPLv3) — [github.com/bigcapitalhq/bigcapital](https://github.com/bigcapitalhq/bigcapital); Akaunting (BSL 1.1, forbids Accounting Service use) — [akaunting.com/license](https://akaunting.com/license) | GPL/AGPL/BSL conflict with closed multi-tenant practice SaaS without counsel + possible commercial licence; Fineract is core-banking shaped, not UAE VAT practice | High integration tax into existing Next/RLS app | **Reject Akaunting** for practice SaaS (BSL §Accounting Service). **Defer Fineract/ERPNext/Bigcapital/LedgerSMB** unless spike proves ≥8 person-week savings with counsel sign-off |
| **Build ledger core here** | Journals, COA, locks, AR/AP, FX in Postgres with RLS | Full ownership; must implement close/statements ourselves | Aligns with existing stack and VAT pack design | **Recommended default** |
| **Integrate AI bookkeeping** | Tofu, Docyt, Combinely, Accy, Pilot, Basis, Stacks | Product overlap; still need SoR | Useful as UX/process references, not SoR | Steal patterns; do not become dependent |

Evidence that would flip to adopt: time-boxed spike (≤2 person-weeks) shows an Apache-2.0 or commercially licensed core can host multi-tenant RLS, UAE COA, and VAT control accounts without AGPL/GPL SaaS risk.

### 3.3 Stages A–E (D split into D1/D2)

| Stage | Scope | Exit evidence | Kill criteria | Person-weeks best / likely / worst |
|---|---|---|---|---|
| **A** Ledger + thin slice | Minimal COA, journals, period locks, DB balance check; docs → extract → review → postings → draft VAT201 from ledger | One synthetic client: balanced postings; source-linked entries; draft VAT201 reproducible; unit/property tests for balance | Cannot enforce balanced journals in DB; cannot link entry→source | 10 / **16** / 24 |
| **B** VAT201 + release gate | VAT control, rules, QA, dual-control release, portal download (status/version/date), download audit; **no FTA submit** | Preparer≠approver enforced 90 days; upstream change voids release; download log complete | Dual-control bypassable; pack numbers diverge from ledger | 8 / **14** / 20 |
| **C** Recon + AR/AP | Bank/invoice/AR/AP/VAT-control recon (1–many, partial, FX, fees, staleness) | Sub-ledger = control within tolerance; exception queue operable | Systematic control breaks unresolved >2 pilot periods | 10 / **18** / 28 |
| **D1** Accruals / depr / close / TB | Accruals, prepayments, FA+depr schedules, period close checklist, trial balance | Closed period immutable without reopen workflow; TB balances | Close without TB identity | 6 / **12** / 18 |
| **D2** Statements / YE / RE | P&L, BS, CF; year-end; retained earnings; integrity gates block release | A=L+E; RE roll-forward; gates block bad packs | Statement release without integrity gate | 6 / **12** / 18 |
| **E** Corporate tax | CT computation report off ledger (not deferred tax) | Adjustments trail; approve-before-download | CT numbers not reconcilable to ledger | 4 / **8** / 14 |
| **Portal security review** (gate) | MFA, isolation, roles, STRIDE, download gating — detail in doc 06 | Written pass from security review | Fail → **no real client data** | 3 / **5** / 8 |

**Team assumption for ranges:** 2 full-stack engineers + 0.5 accounting SME + 0.25 design; calendar ≈ person-weeks / 2.5. Ranges exclude Arnifi ops training time.

**Cut candidates (if schedule slips):** fancy CrossVal-class dashboards; partial-payment subset-sum sophistication; cash-flow layout polish; CT multi-regime; Drive/ERP connectors (after A/B); vision-LLM extraction (stay on one OCR path).

**Hard data gate:** No production client documents, Drive sync, or portal client users until **portal security review** (doc 06) status = PASS. Synthetic and approved anonymised data only before that.

### 3.4 Three-stage validation protocol

| Validation stage | What runs | Exit criteria | Data allowed |
|---|---|---|---|
| **V1 Back-test** | Replay extraction→postings→VAT201 against **filed VAT returns and report exports the owner supplies** | Field/box match within agreed tolerance; failures triaged with root cause | Owner-supplied goldens only; stay on-machine; no external API |
| **V2 Shadow** | Parallel run on live periods; arnibooks does not release packs | Shadow VAT201 vs preparer spreadsheet/vendor ≤ tolerance for N consecutive periods (**N default 2, UNVERIFIED**) | Synthetic + approved anonymised; still no external send of client PDFs until policy allows |
| **V3 Pilot** | 3–5 clients; dual-control release; client/Arnifi files in FTA portal outside product | Cycle time and error metrics beat baseline; zero integrity-gate bypasses | Real clients only after portal security PASS |

### 3.5 Baseline metrics to capture now (ROI)

| Metric | How to measure | Owner |
|---|---|---|
| Hours per client per VAT/bookkeeping period | Time sheets / sample of 10 clients | Ops lead |
| Vendor cost per return or per client-month | Finance | Finance |
| Error / amendment rate | FTA queries + internal rework count | Tax lead |
| Docs per client-month by type | Drive folder sample | Ops |
| Accountant fully-loaded hourly cost | Finance (**not known yet** per owner) | Finance |

## 4. Cost and effort

| Item | Estimate | Basis |
|---|---|---|
| Stages A–E eng (likely) | ~80 person-weeks | Sum of likelys above |
| Portal security review | ~5 person-weeks | Table §3.3 |
| Validation V1–V3 calendar | 2–4 months overlapping B–D | Ops availability **UNVERIFIED** |
| SaaS buy alternative | **UNVERIFIED** $ | Needs vendor quotes (Xero/Zoho practice plans) |
| OSS adopt spike | 2 person-weeks | Cap before decide |

No unit cloud prices asserted here; see doc 07 later.

## 5. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UI polish pressure delays ledger | H | H | Stage A exit is non-negotiable; shell is parallel thin track |
| GPL/AGPL accidental embed | M | H | Default build; counsel before any OSS adopt |
| Real data before portal hardening | M | H | Explicit gate in CI/env flags |
| No golden filed returns | M | H | Block V1; collect packs from ops |
| Dual-control social bypass | M | M | Enforce distinct user IDs in DB for 90 days |

## 6. Evidence still needed

- Accountant hourly cost and document mix (owner: pending).
- Existing AWS region for Arnifi (**UNVERIFIED**).
- Filed VAT201 goldens for V1.
- ERP product name and whether API exists (**unknown**).
- Legal review of any OSS adopt candidate if spike requested.
- Accounting lead sign-off that “management accounts” label is acceptable until IFRS for SMEs layout is certified (UAE CT allows IFRS for SMEs when revenue ≤ AED 50m — [MoF MD 114/2023](https://mof.gov.ae/wp-content/uploads/2023/05/Ministerial-Decision-No.-114-of-2023-on-the-Accounting-Standards-and-Methods-for-Corporate-Tax-Purposes.pdf); FTA CT guide 2023-11-06 — [tax.gov.ae Accounting Standards Guide](https://tax.gov.ae/Datafolder/Files/Guides/CT/Accounting%20Standards%20Guide%20-%2006%2011%202023.pdf)).

## 7. Open questions for you (≤10)

1. Confirm person-week ranges acceptable given 2-eng team assumption?
2. Approve 2-person-week OSS ledger spike, or lock “build” now?
3. What N periods for V2 shadow exit (default 2)?
4. Which 3–5 pilot clients for V3?
5. Hourly cost + docs/month mix numbers?
6. AWS account region today?
7. ERP name + API yes/no?
8. Who supplies filed VAT goldens and by when?
9. Should Stage B portal download ship before or with Stage C?
10. Dual-control after day 90: keep forever or relax to single approver for tiny clients?
