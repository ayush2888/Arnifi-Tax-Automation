import { randomUUID } from "node:crypto";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { createJournal, postJournal } from "@/server/ledger";
import { listPostingRules, pickPostingRule } from "@/server/pipeline-config";
import { assertSyntheticTenant } from "@/server/security-gate";

export type ProposalLine = {
  accountId: string;
  debitMinor: number;
  creditMinor: number;
  currency?: string;
  vat201Box?: string | null;
  lineMemo?: string;
  originalCurrency?: string | null;
  originalMinor?: number | null;
  fxRateScaled?: number | null;
  aedMinor?: number | null;
};

export type Proposal = {
  id: string;
  clientId: string;
  periodId: string;
  status: string;
  confidence: number;
  memo: string;
  entryDate: string;
  warnings: string[];
  lines: ProposalLine[];
  journalEntryId: string | null;
  sourceDocumentId: string | null;
};

async function accountByCode(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> },
  clientId: string,
  code: string,
) {
  const row = await db.query(
    `SELECT id FROM chart_accounts WHERE client_id = $1 AND code = $2 AND active LIMIT 1`,
    [clientId, code],
  );
  return row.rows[0] ? String(row.rows[0].id) : null;
}

async function requireAccountByCode(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> },
  clientId: string,
  code: string,
) {
  const id = await accountByCode(db, clientId, code);
  if (!id) throw new LedgerError(`coa_missing_${code}`, "bad_request");
  return id;
}

export async function proposeFromDocumentFacts(
  userId: string,
  clientId: string,
  body: {
    periodId: string;
    documentId?: string;
    docType: string;
    entryDate: string;
    memo?: string;
    taxableMinor: number;
    vatMinor: number;
    isDisbursement?: boolean;
    itemDescription?: string;
    counterparty?: string;
    confidence?: number;
    originalCurrency?: string;
    fxRateScaled?: number;
    originalMinor?: number;
  },
) {
  const rules = await listPostingRules(userId, clientId);
  const rule = pickPostingRule(rules, {
    docType: body.docType,
    vendor: body.counterparty,
    item: body.itemDescription,
    narration: body.memo,
  });

  const warnings: string[] = [];
  const isDisbursement = body.isDisbursement || rule?.lineFlag === "disbursement";
  if ((rule?.deferMonths || 0) > 0) {
    warnings.push("defer_months_stub_full_recognize");
  }

  const lines: ProposalLine[] = [];
  const confidence = body.confidence ?? (rule ? 80 : 40);

  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const AR = await requireAccountByCode(db, clientId, "1100");
    const AP = await requireAccountByCode(db, clientId, "2000");
    const VAT_IN = await requireAccountByCode(db, clientId, "1200");
    const VAT_OUT = await requireAccountByCode(db, clientId, "2100");
    const REVENUE = await requireAccountByCode(db, clientId, "4000");
    const EXPENSE = await requireAccountByCode(db, clientId, "5000");
    const BANK = await requireAccountByCode(db, clientId, "1000");
    const SUSPENSE = (await accountByCode(db, clientId, "1190")) || (await requireAccountByCode(db, clientId, "1000"));
    const DISB_CLEAR = (await accountByCode(db, clientId, "1300")) || EXPENSE;
    const GATEWAY_CLEAR = (await accountByCode(db, clientId, "1310")) || SUSPENSE;
    const CARD_LIAB = (await accountByCode(db, clientId, "2200")) || AP;
    const FEE_EXP = (await accountByCode(db, clientId, "5100")) || EXPENSE;
    const INVENTORY = (await accountByCode(db, clientId, "1400")) || EXPENSE;

    if (body.docType === "SALES_INVOICE") {
      const arDebit = body.taxableMinor + (isDisbursement ? 0 : body.vatMinor);
      lines.push({ accountId: AR, debitMinor: arDebit, creditMinor: 0, lineMemo: body.counterparty || "AR" });
      if (isDisbursement) {
        lines.push({ accountId: DISB_CLEAR, debitMinor: 0, creditMinor: body.taxableMinor, lineMemo: "disbursement" });
      } else {
        const revId =
          (rule?.targetAccountCode && (await accountByCode(db, clientId, rule.targetAccountCode))) || REVENUE;
        lines.push({ accountId: revId, debitMinor: 0, creditMinor: body.taxableMinor, lineMemo: "revenue" });
        if (body.vatMinor) {
          lines.push({
            accountId: VAT_OUT,
            debitMinor: 0,
            creditMinor: body.vatMinor,
            vat201Box: "1b",
            lineMemo: "output VAT",
          });
        }
      }
    } else if (body.docType === "PURCHASE_INVOICE") {
      const asset =
        rule?.lineFlag === "asset"
          ? (rule.targetAccountCode && (await accountByCode(db, clientId, rule.targetAccountCode))) || INVENTORY
          : EXPENSE;
      const expId =
        rule?.lineFlag === "expense"
          ? (rule.targetAccountCode && (await accountByCode(db, clientId, rule.targetAccountCode))) || EXPENSE
          : asset;
      lines.push({ accountId: expId!, debitMinor: body.taxableMinor, creditMinor: 0 });
      if (body.vatMinor) {
        lines.push({
          accountId: VAT_IN,
          debitMinor: body.vatMinor,
          creditMinor: 0,
          vat201Box: "9",
          lineMemo: "input VAT",
        });
      }
      lines.push({
        accountId: AP,
        debitMinor: 0,
        creditMinor: body.taxableMinor + body.vatMinor,
        lineMemo: body.counterparty || "AP",
      });
    } else if (body.docType === "GATEWAY_CSV" || body.docType === "GATEWAY_PDF") {
      const aed = body.taxableMinor;
      lines.push({ accountId: GATEWAY_CLEAR, debitMinor: aed, creditMinor: 0, lineMemo: "gateway clearing" });
      lines.push({ accountId: BANK, debitMinor: 0, creditMinor: aed, lineMemo: "payout match stub" });
      if (body.vatMinor) {
        lines.push({ accountId: FEE_EXP, debitMinor: body.vatMinor, creditMinor: 0, lineMemo: "gateway fee" });
        lines.push({ accountId: GATEWAY_CLEAR, debitMinor: 0, creditMinor: body.vatMinor, lineMemo: "fee from clearing" });
      }
    } else if (body.docType === "CARD_STATEMENT") {
      lines.push({ accountId: EXPENSE, debitMinor: body.taxableMinor, creditMinor: 0 });
      lines.push({ accountId: CARD_LIAB, debitMinor: 0, creditMinor: body.taxableMinor });
    } else if (body.docType === "BANK_STATEMENT") {
      const amt = Math.abs(body.taxableMinor);
      const inbound = body.taxableMinor >= 0;
      lines.push({
        accountId: BANK,
        debitMinor: inbound ? amt : 0,
        creditMinor: inbound ? 0 : amt,
      });
      lines.push({
        accountId: SUSPENSE,
        debitMinor: inbound ? 0 : amt,
        creditMinor: inbound ? amt : 0,
        lineMemo: body.memo || "unmatched bank",
      });
      warnings.push("bank_line_to_suspense");
    } else if (body.docType === "OPENING_TB") {
      throw new LedgerError("use_import_opening_tb", "bad_request");
    } else {
      lines.push({ accountId: SUSPENSE, debitMinor: body.taxableMinor, creditMinor: 0 });
      lines.push({ accountId: EXPENSE, debitMinor: 0, creditMinor: body.taxableMinor });
      warnings.push("fallback_suspense");
    }

    if (body.originalCurrency && body.originalCurrency !== "AED" && body.fxRateScaled && body.originalMinor != null) {
      for (const line of lines) {
        line.originalCurrency = body.originalCurrency;
        line.originalMinor = body.originalMinor;
        line.fxRateScaled = body.fxRateScaled;
        line.aedMinor = line.debitMinor || line.creditMinor;
      }
    }

    const id = randomUUID();
    await db.query(
      `INSERT INTO journal_proposals (
         id, client_id, period_id, source_document_id, status, confidence, memo, entry_date,
         source_span_json, suggested_rule_id, warnings_json, created_by
       ) VALUES ($1,$2,$3,$4,'PROPOSED',$5,$6,$7,'{}'::jsonb,$8,$9::jsonb,$10)`,
      [
        id,
        clientId,
        body.periodId,
        body.documentId ?? null,
        confidence,
        body.memo || body.docType,
        body.entryDate,
        rule?.id ?? null,
        JSON.stringify(warnings),
        userId,
      ],
    );
    for (const line of lines) {
      await db.query(
        `INSERT INTO journal_proposal_lines (
           proposal_id, client_id, account_id, debit_minor, credit_minor, currency, vat201_box, line_memo,
           original_currency, original_minor, fx_rate_scaled, aed_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          clientId,
          line.accountId,
          line.debitMinor,
          line.creditMinor,
          line.currency || "AED",
          line.vat201Box ?? null,
          line.lineMemo || "",
          line.originalCurrency ?? null,
          line.originalMinor ?? null,
          line.fxRateScaled ?? null,
          line.aedMinor ?? null,
        ],
      );
    }
    // Return inline — do not nest another withUser before this transaction commits.
    return {
      id,
      clientId,
      periodId: body.periodId,
      status: "PROPOSED",
      confidence,
      memo: body.memo || body.docType,
      entryDate: body.entryDate,
      warnings,
      lines,
      journalEntryId: null,
      sourceDocumentId: body.documentId ?? null,
    } as Proposal;
  });
}

export async function getProposal(userId: string, clientId: string, proposalId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const head = await db.query(
      `SELECT id, client_id AS "clientId", period_id AS "periodId", status, confidence, memo,
              entry_date AS "entryDate", warnings_json AS warnings,
              journal_entry_id AS "journalEntryId", source_document_id AS "sourceDocumentId"
       FROM journal_proposals WHERE id = $1 AND client_id = $2`,
      [proposalId, clientId],
    );
    if (!head.rowCount) return null;
    const lines = await db.query(
      `SELECT account_id AS "accountId", debit_minor AS "debitMinor", credit_minor AS "creditMinor",
              currency, vat201_box AS "vat201Box", line_memo AS "lineMemo",
              original_currency AS "originalCurrency", original_minor AS "originalMinor",
              fx_rate_scaled AS "fxRateScaled", aed_minor AS "aedMinor"
       FROM journal_proposal_lines WHERE proposal_id = $1 ORDER BY id`,
      [proposalId],
    );
    const row = head.rows[0];
    return {
      id: String(row.id),
      clientId: String(row.clientId),
      periodId: String(row.periodId),
      status: String(row.status),
      confidence: Number(row.confidence),
      memo: String(row.memo),
      entryDate: String(row.entryDate),
      warnings: (row.warnings as string[]) || [],
      lines: lines.rows.map((l) => ({
        accountId: String(l.accountId),
        debitMinor: Number(l.debitMinor),
        creditMinor: Number(l.creditMinor),
        currency: String(l.currency),
        vat201Box: (l.vat201Box as string | null) ?? null,
        lineMemo: String(l.lineMemo || ""),
        originalCurrency: (l.originalCurrency as string | null) ?? null,
        originalMinor: l.originalMinor == null ? null : Number(l.originalMinor),
        fxRateScaled: l.fxRateScaled == null ? null : Number(l.fxRateScaled),
        aedMinor: l.aedMinor == null ? null : Number(l.aedMinor),
      })),
      journalEntryId: (row.journalEntryId as string | null) ?? null,
      sourceDocumentId: (row.sourceDocumentId as string | null) ?? null,
    } as Proposal;
  });
}

export async function listProposals(userId: string, clientId: string, periodId?: string, status?: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const heads = await db.query(
      `SELECT id, client_id AS "clientId", period_id AS "periodId", status, confidence, memo,
              entry_date AS "entryDate", warnings_json AS warnings,
              journal_entry_id AS "journalEntryId", source_document_id AS "sourceDocumentId"
       FROM journal_proposals
       WHERE client_id = $1
         AND ($2::uuid IS NULL OR period_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC
       LIMIT 200`,
      [clientId, periodId ?? null, status ?? null],
    );
    const out: Proposal[] = [];
    for (const row of heads.rows) {
      const lines = await db.query(
        `SELECT account_id AS "accountId", debit_minor AS "debitMinor", credit_minor AS "creditMinor",
                currency, vat201_box AS "vat201Box", line_memo AS "lineMemo",
                original_currency AS "originalCurrency", original_minor AS "originalMinor",
                fx_rate_scaled AS "fxRateScaled", aed_minor AS "aedMinor"
         FROM journal_proposal_lines WHERE proposal_id = $1 ORDER BY id`,
        [row.id],
      );
      out.push({
        id: String(row.id),
        clientId: String(row.clientId),
        periodId: String(row.periodId),
        status: String(row.status),
        confidence: Number(row.confidence),
        memo: String(row.memo),
        entryDate: String(row.entryDate),
        warnings: (row.warnings as string[]) || [],
        lines: lines.rows.map((l) => ({
          accountId: String(l.accountId),
          debitMinor: Number(l.debitMinor),
          creditMinor: Number(l.creditMinor),
          currency: String(l.currency),
          vat201Box: (l.vat201Box as string | null) ?? null,
          lineMemo: String(l.lineMemo || ""),
          originalCurrency: (l.originalCurrency as string | null) ?? null,
          originalMinor: l.originalMinor == null ? null : Number(l.originalMinor),
          fxRateScaled: l.fxRateScaled == null ? null : Number(l.fxRateScaled),
          aedMinor: l.aedMinor == null ? null : Number(l.aedMinor),
        })),
        journalEntryId: (row.journalEntryId as string | null) ?? null,
        sourceDocumentId: (row.sourceDocumentId as string | null) ?? null,
      });
    }
    return out;
  });
}

export async function approveProposal(
  userId: string,
  clientId: string,
  proposalId: string,
  post = true,
  opts?: { allowLowConfidence?: boolean },
) {
  const proposal = await getProposal(userId, clientId, proposalId);
  if (!proposal) throw new LedgerError("proposal_not_found", "not_found");
  if (proposal.status !== "PROPOSED") throw new LedgerError("proposal_not_open", "conflict");
  // Low-confidence / OCR proposals require an explicit human override; never auto-post.
  if (proposal.confidence < 50 && !opts?.allowLowConfidence) {
    throw new LedgerError("low_confidence_requires_review", "forbidden");
  }

  const journal = await createJournal(userId, clientId, {
    periodId: proposal.periodId,
    memo: proposal.memo,
    entryDate: proposal.entryDate,
    sourceDocumentId: proposal.sourceDocumentId || undefined,
    post: false,
    lines: proposal.lines.map((l) => ({
      accountId: l.accountId,
      debitMinor: l.debitMinor,
      creditMinor: l.creditMinor,
      currency: l.currency,
      vat201Box: l.vat201Box,
      lineMemo: l.lineMemo,
    })),
  });

  let journalEntryId: string = String(journal.id);
  if (post) {
    const posted = await postJournal(userId, clientId, journal.id);
    journalEntryId = String(posted.id);
  }

  await withUser(userId, async (db) => {
    await db.query(
      `UPDATE journal_proposals
       SET status = $3, journal_entry_id = $2, updated_at = now()
       WHERE id = $1 AND client_id = $4`,
      [proposalId, journalEntryId, post ? "POSTED" : "APPROVED", clientId],
    );
  });
  return getProposal(userId, clientId, proposalId);
}

export async function importOpeningTbCsv(
  userId: string,
  clientId: string,
  periodId: string,
  csvText: string,
) {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => row.split(","))
    .filter((cols) => cols.length >= 3);

  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const proposalLines: ProposalLine[] = [];
    for (const cols of lines) {
      const code = cols[0].trim();
      const debit = Number(cols[1] || 0);
      const credit = Number(cols[2] || 0);
      if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
        throw new LedgerError("invalid_money", "bad_request");
      }
      const accountId = await accountByCode(db, clientId, code);
      if (!accountId) throw new LedgerError(`unknown_account_${code}`, "bad_request");
      if (debit) proposalLines.push({ accountId, debitMinor: debit, creditMinor: 0, lineMemo: "opening" });
      if (credit) proposalLines.push({ accountId, debitMinor: 0, creditMinor: credit, lineMemo: "opening" });
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO journal_proposals (
         id, client_id, period_id, status, confidence, memo, entry_date, warnings_json, created_by
       ) VALUES ($1,$2,$3,'PROPOSED',90,'Opening TB','2026-01-01','[]'::jsonb,$4)`,
      [id, clientId, periodId, userId],
    );
    for (const line of proposalLines) {
      await db.query(
        `INSERT INTO journal_proposal_lines (
           proposal_id, client_id, account_id, debit_minor, credit_minor, line_memo
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, clientId, line.accountId, line.debitMinor, line.creditMinor, line.lineMemo || ""],
      );
    }
    return getProposal(userId, clientId, id);
  });
}
