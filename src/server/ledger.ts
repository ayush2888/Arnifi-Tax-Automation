import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { assertMinor } from "@/lib/money";

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export type JournalLineInput = {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
  currency?: string;
  vat201Box?: string | null;
  lineMemo?: string;
};

export function sumDebitsCredits(lines: JournalLineInput[]) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    const d = line.debitMinor ?? 0;
    const c = line.creditMinor ?? 0;
    assertMinor(d);
    assertMinor(c);
    if (d < 0 || c < 0) throw new LedgerError("negative_amount", "invalid_money");
    if (d > 0 && c > 0) throw new LedgerError("both_sides", "invalid_line");
    if (d === 0 && c === 0) throw new LedgerError("empty_line", "invalid_line");
    debit += d;
    credit += c;
  }
  return { debit, credit, balanced: debit === credit && debit > 0 };
}

export function assertBalanced(lines: JournalLineInput[]) {
  const { debit, credit, balanced } = sumDebitsCredits(lines);
  if (!balanced) {
    throw new LedgerError(`unbalanced debit=${debit} credit=${credit}`, "journal_unbalanced");
  }
  return { debit, credit };
}

export function trialBalanceFromLines(
  lines: { accountId: string; debitMinor: number; creditMinor: number }[],
) {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const row = byAccount.get(line.accountId) || { debit: 0, credit: 0 };
    row.debit += line.debitMinor;
    row.credit += line.creditMinor;
    byAccount.set(line.accountId, row);
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const accounts = [...byAccount.entries()].map(([accountId, amounts]) => {
    totalDebit += amounts.debit;
    totalCredit += amounts.credit;
    return { accountId, ...amounts, net: amounts.debit - amounts.credit };
  });
  return { accounts, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

function hashJournal(memo: string, entryDate: string, lines: JournalLineInput[]) {
  const payload = JSON.stringify({ memo, entryDate, lines });
  return createHash("sha256").update(payload).digest("hex");
}

async function requireOpenPeriod(db: PoolClient, clientId: string, periodId: string) {
  const period = await db.query(
    `SELECT id, status, period_start, period_end, label
     FROM accounting_periods
     WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
  if (!["OPEN", "REOPENED"].includes(period.rows[0].status)) {
    throw new LedgerError("period_closed", "period_closed");
  }
  return period.rows[0];
}

export async function listPeriods(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, label, period_start AS "periodStart", period_end AS "periodEnd", status
       FROM accounting_periods
       WHERE client_id = $1
       ORDER BY period_start DESC`,
      [clientId],
    );
    return rows.rows;
  });
}

export async function createPeriod(
  userId: string,
  clientId: string,
  body: { label: string; periodStart: string; periodEnd: string },
) {
  return withUser(userId, async (db) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status)
       VALUES ($1,$2,$3,$4,$5,'OPEN')`,
      [id, clientId, body.label, body.periodStart, body.periodEnd],
    );
    return { id, label: body.label, periodStart: body.periodStart, periodEnd: body.periodEnd, status: "OPEN" };
  });
}

export async function listAccounts(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, code, name, account_type AS "accountType",
              is_ar AS "isAr", is_ap AS "isAp", is_vat_control AS "isVatControl",
              is_bank AS "isBank", vat201_box AS "vat201Box"
       FROM chart_accounts
       WHERE client_id = $1 AND active
       ORDER BY code`,
      [clientId],
    );
    return rows.rows;
  });
}

export async function listJournals(userId: string, clientId: string, periodId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT e.id, e.period_id AS "periodId", e.memo, e.entry_date AS "entryDate",
              e.status, e.source_document_id AS "sourceDocumentId",
              e.posted_at AS "postedAt",
              p.label AS "periodLabel",
              COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
              COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
       FROM journal_entries e
       JOIN accounting_periods p ON p.id = e.period_id
       LEFT JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.client_id = $1
         AND ($2::uuid IS NULL OR e.period_id = $2)
       GROUP BY e.id, p.label
       ORDER BY e.entry_date DESC, e.created_at DESC`,
      [clientId, periodId || null],
    );
    return rows.rows;
  });
}

export async function getJournal(userId: string, clientId: string, entryId: string) {
  return withUser(userId, async (db) => {
    const entry = await db.query(
      `SELECT id, period_id AS "periodId", memo, entry_date AS "entryDate", status,
              source_document_id AS "sourceDocumentId", source_extraction_id AS "sourceExtractionId",
              content_hash AS "contentHash", posted_at AS "postedAt"
       FROM journal_entries
       WHERE id = $1 AND client_id = $2`,
      [entryId, clientId],
    );
    if (!entry.rowCount) return null;
    const lines = await db.query(
      `SELECT l.id, l.account_id AS "accountId", a.code AS "accountCode", a.name AS "accountName",
              l.debit_minor AS "debitMinor", l.credit_minor AS "creditMinor",
              l.currency, l.vat201_box AS "vat201Box", l.line_memo AS "lineMemo"
       FROM journal_lines l
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE l.entry_id = $1
       ORDER BY l.debit_minor DESC, a.code`,
      [entryId],
    );
    return { ...entry.rows[0], lines: lines.rows };
  });
}

export async function createJournal(
  userId: string,
  clientId: string,
  body: {
    periodId: string;
    memo?: string;
    entryDate: string;
    lines: JournalLineInput[];
    sourceFileId?: string | null;
    sourceDocumentId?: string | null;
    sourceExtractionId?: string | null;
    post?: boolean;
  },
) {
  assertBalanced(body.lines);
  return withUser(userId, async (db) => {
    await requireOpenPeriod(db, clientId, body.periodId);
    const entryId = randomUUID();
    const memo = body.memo || "";
    const contentHash = hashJournal(memo, body.entryDate, body.lines);
    const status = body.post ? "posted" : "draft";
    await db.query(
      `INSERT INTO journal_entries (
         id, client_id, period_id, source_document_id, source_extraction_id, source_file_id,
         memo, entry_date, status, content_hash, created_by, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entryId,
        clientId,
        body.periodId,
        body.sourceDocumentId || null,
        body.sourceExtractionId || null,
        body.sourceFileId || null,
        memo,
        body.entryDate,
        status,
        contentHash,
        userId,
        body.post ? new Date().toISOString() : null,
      ],
    );
    for (const line of body.lines) {
      await db.query(
        `INSERT INTO journal_lines (
           id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, vat201_box, line_memo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          entryId,
          clientId,
          line.accountId,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          line.currency || "AED",
          line.vat201Box ?? null,
          line.lineMemo || "",
        ],
      );
    }
    return { id: entryId, status, contentHash };
  });
}

export async function postJournal(userId: string, clientId: string, entryId: string) {
  return withUser(userId, async (db) => {
    const entry = await db.query(
      `SELECT id, period_id, status FROM journal_entries WHERE id = $1 AND client_id = $2`,
      [entryId, clientId],
    );
    if (!entry.rowCount) throw new LedgerError("journal_not_found", "not_found");
    if (entry.rows[0].status === "posted") return { id: entryId, status: "posted" };
    await requireOpenPeriod(db, clientId, entry.rows[0].period_id);
    const lines = await db.query(
      `SELECT account_id AS "accountId", debit_minor AS "debitMinor", credit_minor AS "creditMinor"
       FROM journal_lines WHERE entry_id = $1`,
      [entryId],
    );
    assertBalanced(lines.rows);
    await db.query(
      `UPDATE journal_entries
       SET status = 'posted', posted_at = now()
       WHERE id = $1 AND client_id = $2`,
      [entryId, clientId],
    );
    return { id: entryId, status: "posted" };
  });
}

export async function trialBalance(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
              COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
              COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
       FROM chart_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted' AND e.period_id = $2
       WHERE a.client_id = $1
       GROUP BY a.id
       HAVING COALESCE(SUM(l.debit_minor), 0) <> 0 OR COALESCE(SUM(l.credit_minor), 0) <> 0
       ORDER BY a.code`,
      [clientId, periodId],
    );
    const totalDebit = rows.rows.reduce((sum, row) => sum + Number(row.debitMinor), 0);
    const totalCredit = rows.rows.reduce((sum, row) => sum + Number(row.creditMinor), 0);
    return {
      accounts: rows.rows,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
    };
  });
}

export async function listDocuments(userId: string, clientId: string, periodId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT d.id, d.period_id AS "periodId", d.doc_type AS "docType", d.original_name AS "originalName",
              d.status, d.created_at AS "createdAt",
              p.label AS "periodLabel",
              e.id AS "extractionId",
              e.status AS "extractionStatus"
       FROM documents d
       JOIN accounting_periods p ON p.id = d.period_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM document_extractions
         WHERE document_id = d.id
         ORDER BY version DESC LIMIT 1
       ) e ON true
       WHERE d.client_id = $1
         AND ($2::uuid IS NULL OR d.period_id = $2)
       ORDER BY d.created_at DESC`,
      [clientId, periodId || null],
    );
    return rows.rows;
  });
}

export async function createSyntheticDocument(
  userId: string,
  clientId: string,
  body: {
    periodId: string;
    docType: "SALES_INVOICE" | "PURCHASE_INVOICE" | "CREDIT_NOTE" | "BANK_STATEMENT" | "OTHER";
    originalName: string;
    facts: Record<string, unknown>;
  },
) {
  return withUser(userId, async (db) => {
    await requireOpenPeriod(db, clientId, body.periodId);
    const documentId = randomUUID();
    const extractionId = randomUUID();
    await db.query(
      `INSERT INTO documents (
         id, client_id, period_id, doc_type, original_name, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,'needs_review',$6)`,
      [documentId, clientId, body.periodId, body.docType, body.originalName, userId],
    );
    await db.query(
      `INSERT INTO document_extractions (
         id, document_id, client_id, version, facts_json, status
       ) VALUES ($1,$2,$3,1,$4::jsonb,'draft')`,
      [extractionId, documentId, clientId, JSON.stringify(body.facts)],
    );
    return { id: documentId, extractionId, status: "needs_review" };
  });
}

export async function getExtraction(userId: string, clientId: string, extractionId: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `SELECT e.id, e.document_id AS "documentId", e.version, e.facts_json AS facts,
              e.status, d.doc_type AS "docType", d.period_id AS "periodId", d.original_name AS "originalName"
       FROM document_extractions e
       JOIN documents d ON d.id = e.document_id
       WHERE e.id = $1 AND e.client_id = $2`,
      [extractionId, clientId],
    );
    return row.rows[0] || null;
  });
}

type AccountRow = {
  id: string;
  code: string;
  is_ar: boolean;
  is_ap: boolean;
  is_vat_control: boolean;
  vat201_box: string | null;
  account_type: string;
};

async function accountsByFlag(db: PoolClient, clientId: string) {
  const rows = await db.query(
    `SELECT id, code, is_ar, is_ap, is_vat_control, vat201_box, account_type
     FROM chart_accounts WHERE client_id = $1 AND active`,
    [clientId],
  );
  const list = rows.rows as AccountRow[];
  const find = (pred: (a: AccountRow) => boolean, label: string) => {
    const hit = list.find(pred);
    if (!hit) throw new LedgerError(`missing_account_${label}`, "coa_incomplete");
    return hit;
  };
  return {
    ar: find((a) => a.is_ar, "ar"),
    ap: find((a) => a.is_ap, "ap"),
    vatOut: find((a) => a.is_vat_control && a.vat201_box === "1b", "vat_out"),
    vatIn: find((a) => a.is_vat_control && a.vat201_box === "9", "vat_in"),
    revenue: find((a) => a.account_type === "income" && a.code === "4000", "revenue"),
    expense: find((a) => a.account_type === "expense" && a.code === "5000", "expense"),
  };
}

export async function approveExtractionAndPost(userId: string, clientId: string, extractionId: string) {
  return withUser(userId, async (db) => {
    const extraction = await db.query(
      `SELECT e.id, e.document_id, e.facts_json, e.status, d.period_id, d.doc_type, d.status AS doc_status
       FROM document_extractions e
       JOIN documents d ON d.id = e.document_id
       WHERE e.id = $1 AND e.client_id = $2`,
      [extractionId, clientId],
    );
    if (!extraction.rowCount) throw new LedgerError("extraction_not_found", "not_found");
    const row = extraction.rows[0];
    if (row.status === "approved" && row.doc_status === "posted") {
      throw new LedgerError("already_posted", "conflict");
    }
    await requireOpenPeriod(db, clientId, row.period_id);
    const facts = row.facts_json as {
      entryDate?: string;
      taxableMinor?: number;
      vatMinor?: number;
      counterparty?: string;
      invoiceNumber?: string;
    };
    const taxable = Number(facts.taxableMinor ?? 0);
    const vat = Number(facts.vatMinor ?? 0);
    assertMinor(taxable);
    assertMinor(vat);
    if (taxable <= 0) throw new LedgerError("bad_taxable", "invalid_money");
    const coa = await accountsByFlag(db, clientId);
    const entryDate = String(facts.entryDate || new Date().toISOString().slice(0, 10));
    const memo = `${row.doc_type} ${facts.invoiceNumber || ""} ${facts.counterparty || ""}`.trim();
    let lines: JournalLineInput[] = [];
    if (row.doc_type === "SALES_INVOICE") {
      const total = taxable + vat;
      lines = [
        { accountId: coa.ar.id, debitMinor: total, lineMemo: memo },
        { accountId: coa.revenue.id, creditMinor: taxable, lineMemo: memo },
        { accountId: coa.vatOut.id, creditMinor: vat, vat201Box: "1b", lineMemo: memo },
      ];
    } else if (row.doc_type === "PURCHASE_INVOICE") {
      const total = taxable + vat;
      lines = [
        { accountId: coa.expense.id, debitMinor: taxable, lineMemo: memo },
        { accountId: coa.vatIn.id, debitMinor: vat, vat201Box: "9", lineMemo: memo },
        { accountId: coa.ap.id, creditMinor: total, lineMemo: memo },
      ];
    } else {
      throw new LedgerError("unsupported_doc_type", "bad_request");
    }
    assertBalanced(lines);

    await db.query(
      `UPDATE document_extractions
       SET status = 'approved', approved_at = now(), approved_by = $2
       WHERE id = $1`,
      [extractionId, userId],
    );
    await db.query(`UPDATE documents SET status = 'approved' WHERE id = $1`, [row.document_id]);

    const entryId = randomUUID();
    const contentHash = hashJournal(memo, entryDate, lines);
    await db.query(
      `INSERT INTO journal_entries (
         id, client_id, period_id, source_document_id, source_extraction_id,
         memo, entry_date, status, content_hash, created_by, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8,$9,now())`,
      [entryId, clientId, row.period_id, row.document_id, extractionId, memo, entryDate, contentHash, userId],
    );
    for (const line of lines) {
      await db.query(
        `INSERT INTO journal_lines (
           id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, vat201_box, line_memo
         ) VALUES ($1,$2,$3,$4,$5,$6,'AED',$7,$8)`,
        [
          randomUUID(),
          entryId,
          clientId,
          line.accountId,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          line.vat201Box ?? null,
          line.lineMemo || "",
        ],
      );
    }
    await db.query(`UPDATE documents SET status = 'posted' WHERE id = $1`, [row.document_id]);
    return { documentId: row.document_id, extractionId, journalEntryId: entryId };
  });
}

export async function vat201Draft(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const period = await db.query(
      `SELECT id, label, period_start AS "periodStart", period_end AS "periodEnd", status
       FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
    const rows = await db.query(
      `SELECT COALESCE(l.vat201_box, a.vat201_box) AS box,
              COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
              COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE e.client_id = $1
         AND e.period_id = $2
         AND e.status = 'posted'
         AND COALESCE(l.vat201_box, a.vat201_box) IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
      [clientId, periodId],
    );
    const boxes: Record<string, { taxableMinor: number; vatMinor: number }> = {};
    for (const row of rows.rows) {
      const box = String(row.box);
      // Output boxes (1b): credit on VAT payable is VAT; paired taxable is credit on revenue — report vat from control credit.
      // Input box 9: debit on VAT recoverable is VAT.
      if (box === "9") {
        boxes[box] = {
          taxableMinor: 0,
          vatMinor: Number(row.debitMinor),
        };
      } else {
        boxes[box] = {
          taxableMinor: 0,
          vatMinor: Number(row.creditMinor),
        };
      }
    }
    // Enrich taxable from revenue/expense journals linked via same entries that touched VAT boxes.
    const taxable = await db.query(
      `SELECT COALESCE(l.vat201_box, a.vat201_box) AS box,
              SUM(
                CASE
                  WHEN a.account_type = 'income' THEN l.credit_minor
                  WHEN a.account_type = 'expense' THEN l.debit_minor
                  ELSE 0
                END
              )::bigint AS "taxableMinor"
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted'
         AND e.id IN (
           SELECT DISTINCT l2.entry_id
           FROM journal_lines l2
           JOIN journal_entries e2 ON e2.id = l2.entry_id
           WHERE e2.client_id = $1 AND e2.period_id = $2 AND e2.status = 'posted'
             AND l2.vat201_box IS NOT NULL
         )
       GROUP BY 1`,
      [clientId, periodId],
    );
    for (const row of taxable.rows) {
      const box = String(row.box || "");
      if (!box || box === "null") continue;
      // Map income lines to output box 1b and expenses to input box 9 when vat box null on P&L lines.
    }
    // Simpler approach: compute taxable from facts on source extractions for posted docs in period.
    const fromDocs = await db.query(
      `SELECT d.doc_type,
              COALESCE((e.facts_json->>'taxableMinor')::bigint, 0) AS taxable,
              COALESCE((e.facts_json->>'vatMinor')::bigint, 0) AS vat
       FROM documents d
       JOIN document_extractions e ON e.document_id = d.id AND e.status = 'approved'
       WHERE d.client_id = $1 AND d.period_id = $2 AND d.status = 'posted'`,
      [clientId, periodId],
    );
    let outTaxable = 0;
    let outVat = 0;
    let inTaxable = 0;
    let inVat = 0;
    for (const row of fromDocs.rows) {
      if (row.doc_type === "SALES_INVOICE") {
        outTaxable += Number(row.taxable);
        outVat += Number(row.vat);
      }
      if (row.doc_type === "PURCHASE_INVOICE") {
        inTaxable += Number(row.taxable);
        inVat += Number(row.vat);
      }
    }
    // Prefer document facts when present; else fall back to control account VAT only.
    if (outVat || outTaxable) {
      boxes["1b"] = { taxableMinor: outTaxable, vatMinor: outVat };
    }
    if (inVat || inTaxable) {
      boxes["9"] = { taxableMinor: inTaxable, vatMinor: inVat };
    }
    const totalOutputVat = Object.entries(boxes)
      .filter(([box]) => box !== "9" && box !== "10")
      .reduce((sum, [, v]) => sum + v.vatMinor, 0);
    const totalInputVat = (boxes["9"]?.vatMinor || 0) + (boxes["10"]?.vatMinor || 0);
    return {
      period: period.rows[0],
      boxes,
      totalOutputVat,
      totalInputVat,
      netPayable: totalOutputVat - totalInputVat,
      status: "DRAFT",
      note: "Draft from ledger - Stage B adds dual-control release and client download.",
    };
  });
}
