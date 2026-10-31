import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { assertMinor } from "@/lib/money";
import { signedGetUrl } from "@/lib/storage";
import { LedgerError } from "@/server/errors";
import {
  buildInvoiceJournalLines,
  invoiceBlockers,
  withAedAmounts,
  type InvoiceDocType,
  type InvoiceFacts,
  type PostingAccounts,
} from "@/server/invoice-posting";
import { assertBalanced, hashJournal, requireOpenPeriod } from "@/server/ledger";
import { createOpenItemFromInvoice } from "@/server/recon";
import { markVatPacksStale } from "@/server/release";
import { assertSyntheticTenant } from "@/server/security-gate";

export const INVOICE_DOC_TYPES = ["SALES_INVOICE", "PURCHASE_INVOICE"] as const;

function isInvoiceType(docType: string): docType is InvoiceDocType {
  return (INVOICE_DOC_TYPES as readonly string[]).includes(docType);
}

async function audit(
  db: PoolClient,
  userId: string,
  clientId: string,
  entity: string,
  entityId: string,
  action: string,
  diff: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
     SELECT firm_id, $2, $3, $4, $5, $1, $6::jsonb FROM users WHERE id = $1`,
    [userId, clientId, entity, entityId, action, JSON.stringify(diff)],
  );
}

export async function enqueueInvoiceExtract(db: PoolClient, clientId: string, documentId: string, actorUserId: string) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO books_jobs (id, client_id, kind, status, payload, run_at)
     VALUES ($1,$2,'invoice_extract','queued',$3::jsonb,now())`,
    [id, clientId, JSON.stringify({ documentId, actorUserId })],
  );
  return id;
}

async function postingAccounts(db: PoolClient, clientId: string): Promise<PostingAccounts> {
  const rows = await db.query(
    `SELECT id, code, name, is_ar, is_ap, is_vat_control, vat201_box, account_type
     FROM chart_accounts WHERE client_id = $1 AND active
     ORDER BY code`,
    [clientId],
  );
  const list = rows.rows as {
    id: string;
    code: string;
    name: string;
    is_ar: boolean;
    is_ap: boolean;
    is_vat_control: boolean;
    vat201_box: string | null;
    account_type: string;
  }[];
  const pick = (pred: (a: (typeof list)[number]) => boolean, label: string) => {
    const hit = list.find(pred);
    if (!hit) throw new LedgerError(`missing_account_${label}`, "coa_incomplete");
    return { id: String(hit.id), code: String(hit.code), name: String(hit.name) };
  };
  return {
    ar: pick((a) => a.is_ar, "ar"),
    ap: pick((a) => a.is_ap, "ap"),
    vatOut: pick((a) => a.is_vat_control && a.vat201_box === "1b", "vat_out"),
    vatIn: pick((a) => a.is_vat_control && a.vat201_box === "9", "vat_in"),
    revenue: pick((a) => a.account_type === "income" && a.code === "4000", "revenue"),
    expense: pick((a) => a.account_type === "expense" && a.code === "5000", "expense"),
  };
}

const LIST_SQL = `
  SELECT d.id, d.period_id AS "periodId", d.doc_type AS "docType", d.original_name AS "originalName",
         d.status, d.created_at AS "createdAt", d.created_by AS "createdBy",
         p.label AS "periodLabel", p.period_start AS "periodStart", p.period_end AS "periodEnd",
         p.status AS "periodStatus",
         e.id AS "extractionId", e.version AS "extractionVersion", e.status AS "extractionStatus",
         e.facts_json AS facts,
         j.status AS "jobStatus", j.error AS "jobError",
         je.id AS "journalEntryId"
  FROM documents d
  JOIN accounting_periods p ON p.id = d.period_id
  LEFT JOIN LATERAL (
    SELECT id, version, status, facts_json FROM document_extractions
    WHERE document_id = d.id ORDER BY version DESC LIMIT 1
  ) e ON true
  LEFT JOIN LATERAL (
    SELECT status, error FROM books_jobs
    WHERE kind = 'invoice_extract' AND payload->>'documentId' = d.id::text
    ORDER BY created_at DESC LIMIT 1
  ) j ON true
  LEFT JOIN LATERAL (
    SELECT id FROM journal_entries WHERE source_document_id = d.id AND status = 'posted'
    ORDER BY created_at DESC LIMIT 1
  ) je ON true
`;

type ListRow = {
  id: string;
  periodId: string;
  docType: string;
  originalName: string;
  status: string;
  createdAt: string;
  createdBy: string;
  periodLabel: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  periodStatus: string;
  extractionId: string | null;
  extractionVersion: number | null;
  extractionStatus: string | null;
  facts: InvoiceFacts | null;
  jobStatus: string | null;
  jobError: string | null;
  journalEntryId: string | null;
};

function isoDate(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function summarize(row: ListRow) {
  const facts = row.facts || null;
  const period = { periodStart: isoDate(row.periodStart), periodEnd: isoDate(row.periodEnd) };
  const blockers =
    facts && isInvoiceType(row.docType) && row.status !== "posted" ? invoiceBlockers(facts, row.docType, period) : [];
  return {
    id: row.id,
    periodId: row.periodId,
    periodLabel: row.periodLabel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodStatus: row.periodStatus,
    docType: row.docType,
    originalName: row.originalName,
    status: row.status,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    extractionId: row.extractionId,
    extractionVersion: row.extractionVersion,
    extractionStatus: row.extractionStatus,
    jobStatus: row.jobStatus,
    jobError: row.jobError,
    journalEntryId: row.journalEntryId,
    invoiceNumber: facts?.invoiceNumber ?? null,
    entryDate: facts?.entryDate ?? null,
    counterparty: facts?.counterparty ?? null,
    currency: facts?.currency ?? null,
    originalTotalMinor:
      facts?.originalSubtotalMinor != null ? facts.originalSubtotalMinor + (facts.originalVatMinor ?? 0) : null,
    totalAedMinor: facts?.totalMinor ?? null,
    docKind: facts?.docKind ?? null,
    warnings: row.status === "posted" ? [] : (facts?.warnings ?? []).filter((w) => w !== "date_outside_month"),
    blockers,
  };
}

/** Every uploaded document for the company, all months, newest first. */
export async function listCompanyDocuments(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(`${LIST_SQL} WHERE d.client_id = $1 ORDER BY p.period_start DESC, d.created_at DESC`, [
      clientId,
    ]);
    return (rows.rows as ListRow[]).map(summarize);
  });
}

async function loadDocument(db: PoolClient, clientId: string, documentId: string) {
  const rows = await db.query(`${LIST_SQL} WHERE d.client_id = $1 AND d.id = $2`, [clientId, documentId]);
  if (!rows.rowCount) throw new LedgerError("document_not_found", "not_found");
  return rows.rows[0] as ListRow;
}

export async function getCompanyDocument(userId: string, clientId: string, documentId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await loadDocument(db, clientId, documentId);
    const file = await db.query(
      `SELECT f.storage_key, f.detected_mime FROM documents d JOIN files f ON f.id = d.file_id WHERE d.id = $1`,
      [documentId],
    );
    let fileUrl: string | null = null;
    if (file.rowCount) {
      try {
        fileUrl = await signedGetUrl(String(file.rows[0].storage_key));
      } catch {
        fileUrl = null;
      }
    }

    let preview: ReturnType<typeof buildInvoiceJournalLines> | null = null;
    let previewError: string | null = null;
    if (row.facts && isInvoiceType(row.docType) && row.status !== "posted") {
      try {
        preview = buildInvoiceJournalLines(row.facts, row.docType, await postingAccounts(db, clientId));
      } catch (error) {
        previewError = error instanceof Error ? error.message : "preview_failed";
      }
    }

    let posted: { entryId: string; entryDate: string; memo: string; lines: unknown[] } | null = null;
    if (row.journalEntryId) {
      const entry = await db.query(`SELECT id, entry_date, memo FROM journal_entries WHERE id = $1`, [
        row.journalEntryId,
      ]);
      const lines = await db.query(
        `SELECT a.code AS "accountCode", a.name AS "accountName", l.debit_minor AS "debitMinor",
                l.credit_minor AS "creditMinor", l.original_currency AS "originalCurrency",
                l.original_minor AS "originalMinor", l.fx_rate_scaled AS "fxRateScaled", l.vat201_box AS "vat201Box"
         FROM journal_lines l JOIN chart_accounts a ON a.id = l.account_id
         WHERE l.entry_id = $1 ORDER BY l.debit_minor DESC, a.code`,
        [row.journalEntryId],
      );
      posted = {
        entryId: String(entry.rows[0].id),
        entryDate: isoDate(entry.rows[0].entry_date),
        memo: String(entry.rows[0].memo),
        lines: lines.rows.map((l) => ({
          ...l,
          debitMinor: Number(l.debitMinor),
          creditMinor: Number(l.creditMinor),
          originalMinor: l.originalMinor == null ? null : Number(l.originalMinor),
          fxRateScaled: l.fxRateScaled == null ? null : Number(l.fxRateScaled),
        })),
      };
    }

    const history = await db.query(
      `SELECT a.action, a.at, a.diff, u.email AS actor
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor
       WHERE a.client_id = $1 AND (a.entity_id = $2 OR a.entity_id = $3 OR a.diff->>'documentId' = $2::text)
       ORDER BY a.at DESC LIMIT 30`,
      [clientId, documentId, row.extractionId],
    );

    return {
      ...summarize(row),
      facts: row.facts,
      fileUrl,
      mime: file.rows[0]?.detected_mime ?? null,
      preview: preview
        ? { lines: preview.lines, memo: preview.memo, vatRecoverable: preview.vatRecoverable, totalAed: preview.totalAed }
        : null,
      previewError,
      posted,
      history: history.rows,
    };
  });
}

const EDITABLE_FIELDS = [
  "invoiceNumber",
  "entryDate",
  "dueDate",
  "counterparty",
  "counterpartyTrn",
  "supplierTrn",
  "currency",
  "originalSubtotalMinor",
  "originalVatMinor",
  "fxRateScaled",
  "docKind",
  "memo",
] as const;

const MINOR_FIELDS = new Set(["originalSubtotalMinor", "originalVatMinor", "fxRateScaled"]);
const DOC_KINDS = new Set(["TAX_INVOICE", "INVOICE", "PROFORMA", "QUOTATION", "CREDIT_NOTE", "UNKNOWN"]);

/** Accountant corrections to the extracted draft. Recomputes AED amounts; audited. */
export async function updateDocumentFacts(
  userId: string,
  clientId: string,
  documentId: string,
  body: { facts?: Partial<InvoiceFacts>; docType?: string; periodId?: string },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await loadDocument(db, clientId, documentId);
    if (row.status === "posted") throw new LedgerError("document_posted", "conflict");
    if (row.status === "rejected") throw new LedgerError("document_removed", "conflict");

    if (body.periodId && body.periodId !== row.periodId) {
      const target = await db.query(`SELECT id, status FROM accounting_periods WHERE id = $1 AND client_id = $2`, [
        body.periodId,
        clientId,
      ]);
      if (!target.rowCount) throw new LedgerError("period_not_found", "not_found");
      await requireOpenPeriod(db, clientId, body.periodId);
      await db.query(`UPDATE documents SET period_id = $2 WHERE id = $1`, [documentId, body.periodId]);
      await audit(db, userId, clientId, "document", documentId, "move_period", {
        before: { periodId: row.periodId },
        after: { periodId: body.periodId },
      });
    }

    if (body.docType && body.docType !== row.docType) {
      if (!isInvoiceType(body.docType)) throw new LedgerError("unsupported_doc_type", "bad_request");
      await db.query(`UPDATE documents SET doc_type = $2 WHERE id = $1`, [documentId, body.docType]);
      await audit(db, userId, clientId, "document", documentId, "change_type", {
        before: { docType: row.docType },
        after: { docType: body.docType },
      });
    }

    if (body.facts && row.extractionId) {
      const before = (row.facts || {}) as InvoiceFacts;
      const next: InvoiceFacts = { ...before };
      const changed: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of EDITABLE_FIELDS) {
        if (!(key in body.facts)) continue;
        let value = (body.facts as Record<string, unknown>)[key];
        if (value === "") value = null;
        if (MINOR_FIELDS.has(key) && value !== null) {
          if (assertMinor(value) === null || (value as number) < 0) throw new LedgerError(`bad_${key}`, "invalid_money");
        }
        if (key === "entryDate" || key === "dueDate") {
          if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new LedgerError(`bad_${key}`, "bad_request");
        }
        if (key === "currency" && value !== null) {
          value = String(value).toUpperCase();
          if (!/^[A-Z]{3}$/.test(String(value))) throw new LedgerError("bad_currency", "bad_request");
        }
        if (key === "docKind" && value !== null && !DOC_KINDS.has(String(value))) {
          throw new LedgerError("bad_docKind", "bad_request");
        }
        if ((before as Record<string, unknown>)[key] !== value) {
          changed[key] = { before: (before as Record<string, unknown>)[key] ?? null, after: value };
          (next as Record<string, unknown>)[key] = value;
        }
      }
      if (Object.keys(changed).length) {
        if ("fxRateScaled" in changed) next.fxSource = "manual";
        const recomputed = withAedAmounts(next);
        recomputed.warnings = (recomputed.warnings || []).filter((w) =>
          "fxRateScaled" in changed ? w !== "fx_rate_needed" && w !== "fx_rate_defaulted" : true,
        );
        recomputed.editedBy = [...new Set([...(before.editedBy || []), userId])];
        await db.query(`UPDATE document_extractions SET facts_json = $2::jsonb WHERE id = $1 AND status = 'draft'`, [
          row.extractionId,
          JSON.stringify(recomputed),
        ]);
        await audit(db, userId, clientId, "document_extraction", row.extractionId, "update", {
          documentId,
          changed,
        });
      }
    }
    return { ok: true };
  });
}

export async function reextractDocument(userId: string, clientId: string, documentId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await loadDocument(db, clientId, documentId);
    if (row.status === "posted") throw new LedgerError("document_posted", "conflict");
    if (!isInvoiceType(row.docType)) throw new LedgerError("unsupported_doc_type", "bad_request");
    if (row.jobStatus === "queued" || row.jobStatus === "running") return { queued: true };
    if (row.status === "rejected") {
      await db.query(`UPDATE documents SET status = 'uploaded' WHERE id = $1`, [documentId]);
    }
    const jobId = await enqueueInvoiceExtract(db, clientId, documentId, userId);
    await audit(db, userId, clientId, "document", documentId, "extract_requested", { jobId });
    return { queued: true, jobId };
  });
}

/** Soft remove (status=rejected). Posted documents can only be corrected by reversal. */
export async function removeDocument(userId: string, clientId: string, documentId: string, reason?: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await loadDocument(db, clientId, documentId);
    if (row.status === "posted") throw new LedgerError("document_posted", "conflict");
    await db.query(`UPDATE documents SET status = 'rejected' WHERE id = $1`, [documentId]);
    if (row.extractionId) {
      await db.query(`UPDATE document_extractions SET status = 'rejected' WHERE id = $1 AND status = 'draft'`, [
        row.extractionId,
      ]);
    }
    await audit(db, userId, clientId, "document", documentId, "remove", {
      before: { status: row.status },
      after: { status: "rejected" },
      reason: reason || null,
    });
    return { ok: true };
  });
}

/** Dual control: only an approver/admin who neither uploaded nor edited the draft can post it. */
export async function approveAndPostDocument(userId: string, clientId: string, documentId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await loadDocument(db, clientId, documentId);
    if (row.status === "posted") throw new LedgerError("already_posted", "conflict");
    if (row.status === "rejected") throw new LedgerError("document_removed", "conflict");
    if (!isInvoiceType(row.docType)) throw new LedgerError("unsupported_doc_type", "bad_request");
    if (!row.extractionId || !row.facts || row.extractionStatus !== "draft") {
      throw new LedgerError("nothing_to_post", "conflict");
    }

    const role = await db.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (!["admin", "approver"].includes(String(role.rows[0]?.role))) {
      throw new LedgerError("post_requires_approver", "forbidden");
    }
    const preparers = new Set([row.createdBy, ...(row.facts.editedBy || [])]);
    if (preparers.has(userId)) throw new LedgerError("preparer_cannot_approve", "forbidden");

    const period = await requireOpenPeriod(db, clientId, row.periodId);
    const blockers = invoiceBlockers(row.facts, row.docType, {
      periodStart: isoDate(period.period_start),
      periodEnd: isoDate(period.period_end),
    });
    if (blockers.length) throw new LedgerError(`not_ready:${blockers.join(",")}`, "conflict");

    const dup = await db.query(
      `SELECT d.id FROM documents d
       JOIN LATERAL (
         SELECT facts_json FROM document_extractions WHERE document_id = d.id ORDER BY version DESC LIMIT 1
       ) e ON true
       WHERE d.client_id = $1 AND d.id <> $2 AND d.status = 'posted' AND d.doc_type = $3
         AND lower(e.facts_json->>'invoiceNumber') = lower($4)
         AND lower(coalesce(e.facts_json->>'counterparty','')) = lower($5)
       LIMIT 1`,
      [clientId, documentId, row.docType, row.facts.invoiceNumber, row.facts.counterparty || ""],
    );
    if (dup.rowCount) throw new LedgerError("duplicate_invoice_already_posted", "conflict");

    const accounts = await postingAccounts(db, clientId);
    const controlAccountId = row.docType === "SALES_INVOICE" ? accounts.ar.id : accounts.ap.id;
    const built = buildInvoiceJournalLines(row.facts, row.docType, accounts);
    assertBalanced(built.lines);
    const facts = built.facts;
    const entryDate = String(facts.entryDate);

    await db.query(
      `UPDATE document_extractions SET status = 'approved', approved_at = now(), approved_by = $2, facts_json = $3::jsonb
       WHERE id = $1`,
      [row.extractionId, userId, JSON.stringify(facts)],
    );

    const entryId = randomUUID();
    const voucherType = row.docType === "SALES_INVOICE" ? "Sales" : row.docType === "PURCHASE_INVOICE" ? "Purchase" : "Journal";
    await db.query(
      `INSERT INTO journal_entries (
         id, client_id, period_id, source_document_id, source_extraction_id,
         memo, entry_date, status, content_hash, created_by, posted_at, voucher_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8,$9,now(),$10)`,
      [
        entryId,
        clientId,
        row.periodId,
        documentId,
        row.extractionId,
        built.memo,
        entryDate,
        hashJournal(built.memo, entryDate, built.lines),
        row.createdBy,
        voucherType,
      ],
    );
    const voucherNo = await db.query(
      `SELECT ledger_next_voucher_no($1::uuid, $2::text, $3::int) AS entry_no`,
      [clientId, voucherType, Number(entryDate.slice(0, 4))],
    );
    await db.query(`UPDATE journal_entries SET entry_no = $2 WHERE id = $1`, [
      entryId,
      String(voucherNo.rows[0].entry_no),
    ]);
    let controlLineId: string | null = null;
    for (const line of built.lines) {
      const lineId = randomUUID();
      await db.query(
        `INSERT INTO journal_lines (
           id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, vat201_box, line_memo,
           original_currency, original_minor, fx_rate_scaled, aed_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,'AED',$7,$8,$9,$10,$11,$12)`,
        [
          lineId,
          entryId,
          clientId,
          line.accountId,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          line.vat201Box ?? null,
          line.lineMemo || "",
          line.originalCurrency,
          line.originalMinor,
          line.fxRateScaled,
          line.aedMinor,
        ],
      );
      if (line.accountId === controlAccountId) controlLineId = lineId;
    }
    if (controlLineId) {
      await createOpenItemFromInvoice(db, {
        clientId,
        periodId: row.periodId,
        side: row.docType === "SALES_INVOICE" ? "AR" : "AP",
        partyName: String(facts.counterparty || "Unknown"),
        documentId,
        journalEntryId: entryId,
        journalLineId: controlLineId,
        reference: String(facts.invoiceNumber || ""),
        amountMinor: built.totalAed,
        openedOn: entryDate,
      });
    }
    await db.query(`UPDATE documents SET status = 'posted' WHERE id = $1`, [documentId]);
    await markVatPacksStale(db, clientId, row.periodId);
    await audit(db, userId, clientId, "journal_entry", entryId, "post", {
      documentId,
      extractionId: row.extractionId,
      preparedBy: row.createdBy,
      approvedBy: userId,
      lines: built.lines.map((l) => ({
        account: l.accountCode,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        originalCurrency: l.originalCurrency,
        originalMinor: l.originalMinor,
      })),
    });
    return { documentId, journalEntryId: entryId, lines: built.lines };
  });
}
