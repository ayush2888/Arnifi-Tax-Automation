import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { assertMinor, formatMinor } from "@/lib/money";
import { putObject } from "@/lib/storage";

export type Actor = { userId: string; clientId: string; role: string; firmId: string };

const SORTS: Record<string, string> = {
  date: "t.txn_date",
  description: "t.description_clean",
  debit: "t.debit_minor",
  credit: "t.credit_minor",
  balance: "t.balance_minor",
  reference: "t.reference",
  confidence: "t.extraction_confidence",
  row: "t.row_no",
};

export type TxnQuery = {
  tab?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMinMinor?: number | null;
  amountMaxMinor?: number | null;
  categoryId?: string;
  flag?: string;
  sort?: string;
  dir?: string;
  offset?: number;
  limit?: number;
};

export async function actor(userId: string, clientId: string): Promise<Actor | null> {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `SELECT u.role, u.firm_id
       FROM users u
       JOIN user_client_access a ON a.user_id = u.id
       WHERE u.id = $1 AND a.client_id = $2`,
      [userId, clientId],
    );
    if (!row.rowCount) return null;
    return { userId, clientId, role: row.rows[0].role, firmId: row.rows[0].firm_id };
  });
}

export async function directory(userId: string) {
  return withUser(userId, async (db) => {
    const users = await db.query(
      `SELECT id, name, email, role FROM users ORDER BY name`,
    );
    const clients = await db.query(
      `SELECT id, name, trn, default_currency FROM clients ORDER BY name`,
    );
    const me = users.rows.find((row) => row.id === userId) ?? null;
    return {
      me: me && { id: me.id, name: me.name, email: me.email, role: me.role },
      users: users.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role })),
      clients: clients.rows.map((row) => ({
        id: row.id,
        name: row.name,
        trn: row.trn,
        defaultCurrency: row.default_currency,
      })),
    };
  });
}

export async function dashboard(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const counts = await db.query(
      `SELECT
         (SELECT count(*) FROM statements s WHERE s.client_id = $1) AS statements,
         (SELECT count(*) FROM bank_transactions t WHERE t.client_id = $1) AS transactions,
         (SELECT count(*) FROM bank_transactions t WHERE t.client_id = $1 AND t.review_status = 'needs_review') AS needs_review,
         (SELECT count(*) FROM statements s WHERE s.client_id = $1 AND (
            'closing_mismatch' = ANY(s.validation_flags)
            OR EXISTS (
              SELECT 1 FROM bank_transactions t
              WHERE t.statement_id = s.id AND 'balance_break' = ANY(t.flags)
            )
         )) AS balance_failures`,
      [clientId],
    );
    const recent = await db.query(
      `SELECT ${STATEMENT_COLUMNS}
       FROM statements s
       JOIN bank_accounts b ON b.id = s.bank_account_id
       JOIN files f ON f.id = s.file_id
       WHERE s.client_id = $1
       ORDER BY s.created_at DESC
       LIMIT 8`,
      [clientId],
    );
    const row = counts.rows[0];
    return {
      statements: Number(row.statements),
      transactions: Number(row.transactions),
      needsReview: Number(row.needs_review),
      balanceFailures: Number(row.balance_failures),
      recent: recent.rows.map(mapStatement),
    };
  });
}

export async function bankAccounts(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, bank_name, label, iban_masked, currency
       FROM bank_accounts WHERE client_id = $1 ORDER BY label`,
      [clientId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      bankName: row.bank_name,
      label: row.label,
      ibanMasked: row.iban_masked,
      currency: row.currency,
    }));
  });
}

export async function registerUpload(
  userId: string,
  clientId: string,
  bankAccountId: string,
  filename: string,
  content: Buffer,
  mime: string,
) {
  const digest = createHash("sha256").update(content).digest("hex");
  return withUser(userId, async (db) => {
    const role = await db.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (!["admin", "accountant"].includes(role.rows[0]?.role)) {
      return { error: "forbidden" as const };
    }
    const existing = await db.query(
      `SELECT s.id
       FROM files f
       JOIN statements s ON s.file_id = f.id
       WHERE f.client_id = $1 AND f.sha256 = $2
       ORDER BY s.created_at
       LIMIT 1`,
      [clientId, digest],
    );
    if (existing.rowCount) {
      return { statementId: existing.rows[0].id as string, duplicate: true };
    }
    const account = await db.query(
      `SELECT id FROM bank_accounts WHERE id = $1 AND client_id = $2`,
      [bankAccountId, clientId],
    );
    if (!account.rowCount) return { error: "unknown_account" as const };
    const fileId = randomUUID();
    const statementId = randomUUID();
    const jobId = randomUUID();
    const key = `clients/${clientId}/files/${fileId}`;
    await putObject(key, content, mime || "application/octet-stream");
    await db.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [fileId, clientId, digest, filename, mime || "application/octet-stream", content.length, key, userId],
    );
    await db.query(
      `INSERT INTO statements (id, client_id, bank_account_id, file_id, currency, status)
       VALUES ($1,$2,$3,$4,'AED','uploaded')`,
      [statementId, clientId, bankAccountId, fileId],
    );
    await db.query(
      `INSERT INTO jobs (id, client_id, statement_id, file_id, uploaded_by, kind, status)
       VALUES ($1,$2,$3,$4,$5,'ingest','queued')`,
      [jobId, clientId, statementId, fileId, userId],
    );
    await db.query(
      `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
       SELECT firm_id, $2, 'file', $3, 'upload', $4, $5::jsonb FROM users WHERE id = $4`,
      [userId, clientId, fileId, userId, JSON.stringify({ name: filename, bytes: content.length })],
    );
    return { statementId, duplicate: false };
  });
}

const STATEMENT_COLUMNS = `
  s.id, s.status, s.error, s.extraction_method, s.page_count, s.period_start, s.period_end,
  s.opening_minor, s.closing_minor, s.currency, s.validation_flags, s.proposed_mapping,
  s.extracted_row_count, s.created_at, b.bank_name, b.label AS account_label, b.iban_masked,
  f.original_name, f.detected_mime, f.size, f.sha256
`;

export async function listStatements(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT ${STATEMENT_COLUMNS}
       FROM statements s
       JOIN bank_accounts b ON b.id = s.bank_account_id
       JOIN files f ON f.id = s.file_id
       WHERE s.client_id = $1
       ORDER BY s.created_at DESC`,
      [clientId],
    );
    return rows.rows.map(mapStatement);
  });
}

export async function getStatement(userId: string, clientId: string, id: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT ${STATEMENT_COLUMNS}
       FROM statements s
       JOIN bank_accounts b ON b.id = s.bank_account_id
       JOIN files f ON f.id = s.file_id
       WHERE s.id = $1 AND s.client_id = $2`,
      [id, clientId],
    );
    if (!rows.rowCount) return null;
    const events = await db.query(
      `SELECT stage, method, pages, est_cost_usd, duration_ms, created_at
       FROM processing_events WHERE statement_id = $1 ORDER BY created_at`,
      [id],
    );
    return {
      ...mapStatement(rows.rows[0]),
      events: events.rows.map((event) => ({
        stage: event.stage,
        method: event.method,
        pages: event.pages,
        estCostUsd: event.est_cost_usd,
        durationMs: event.duration_ms,
        at: event.created_at,
      })),
    };
  });
}

export async function enqueueConfirm(userId: string, clientId: string, statementId: string, payload: Record<string, unknown>) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    const statement = await db.query(`SELECT file_id FROM statements WHERE id = $1 AND client_id = $2`, [statementId, clientId]);
    if (!statement.rowCount) return { error: "not_found" as const };
    await db.query(
      `INSERT INTO jobs (client_id, statement_id, file_id, uploaded_by, kind, status, payload)
       VALUES ($1,$2,$3,$4,'confirm','queued',$5)`,
      [clientId, statementId, statement.rows[0].file_id, userId, JSON.stringify(payload)],
    );
    await db.query(`UPDATE statements SET status = 'parsing', error = NULL WHERE id = $1`, [statementId]);
    return { ok: true };
  });
}

export async function approveStatement(userId: string, clientId: string, statementId: string) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    const updated = await db.query(
      `UPDATE statements SET status = 'approved'
       WHERE id = $1 AND client_id = $2 AND status IN ('parsed', 'needs_review')
       RETURNING id`,
      [statementId, clientId],
    );
    return { ok: Boolean(updated.rowCount) };
  });
}

function where(query: TxnQuery, clientId: string) {
  const clauses = ["t.client_id = $1"];
  const params: unknown[] = [clientId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (query.tab === "needs_review") clauses.push("t.review_status = 'needs_review'");
  if (query.tab === "unclassified") clauses.push("t.class_status = 'unclassified'");
  if (query.q) {
    params.push(`%${query.q}%`);
    const index = params.length;
    clauses.push(
      `(t.description_raw ILIKE $${index} OR t.description_clean ILIKE $${index} OR COALESCE(t.reference, '') ILIKE $${index})`,
    );
  }
  if (query.dateFrom) add("t.txn_date >= ?", query.dateFrom);
  if (query.dateTo) add("t.txn_date <= ?", query.dateTo);
  if (query.amountMinMinor != null) add("GREATEST(COALESCE(t.debit_minor, 0), COALESCE(t.credit_minor, 0)) >= ?", query.amountMinMinor);
  if (query.amountMaxMinor != null) add("GREATEST(COALESCE(t.debit_minor, 0), COALESCE(t.credit_minor, 0)) <= ?", query.amountMaxMinor);
  if (query.categoryId) add("t.category_id = ?", query.categoryId);
  if (query.flag) add("? = ANY(t.flags)", query.flag);
  const sort = SORTS[query.sort || "date"] || SORTS.date;
  const dir = query.dir === "asc" ? "ASC" : "DESC";
  return { sql: clauses.join(" AND "), params, order: `${sort} ${dir} NULLS LAST, t.row_no ${dir}` };
}

const TXN_SELECT = `
  t.id, t.row_no, t.reference, t.txn_date, t.value_date, t.description_raw, t.description_clean,
  t.counterparty, t.debit_minor, t.credit_minor, t.balance_minor, t.currency, t.category_id,
  c.name AS category_name, t.class_status, t.review_status, t.flags, t.extraction_confidence,
  t.statement_id, t.source_page, t.source_bbox,
  b.bank_name, s.period_start
`;

export async function listTransactions(userId: string, clientId: string, query: TxnQuery) {
  const filter = where(query, clientId);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 150));
  return withUser(userId, async (db) => {
    const total = await db.query(`SELECT count(*) AS n FROM bank_transactions t WHERE ${filter.sql}`, filter.params);
    const rows = await db.query(
      `SELECT ${TXN_SELECT}
       FROM bank_transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN statements s ON s.id = t.statement_id
       JOIN bank_accounts b ON b.id = s.bank_account_id
       WHERE ${filter.sql}
       ORDER BY ${filter.order}
       OFFSET $${filter.params.length + 1} LIMIT $${filter.params.length + 2}`,
      [...filter.params, offset, limit],
    );
    return { total: Number(total.rows[0].n), rows: rows.rows.map(mapTxn) };
  });
}

export async function transactionMeta(userId: string, clientId: string, query: TxnQuery) {
  const countsQuery = { ...query, tab: "all" };
  const filter = where(countsQuery, clientId);
  return withUser(userId, async (db) => {
    const counts = await db.query(
      `SELECT
         count(*) AS all_rows,
         count(*) FILTER (WHERE t.review_status = 'needs_review') AS needs_review,
         count(*) FILTER (WHERE t.class_status = 'unclassified') AS unclassified
       FROM bank_transactions t
       WHERE t.client_id = $1`,
      [clientId],
    );
    const months = await db.query(
      `SELECT to_char(t.txn_date, 'YYYY-MM') AS month, count(*) AS n
       FROM bank_transactions t
       WHERE ${filter.sql}
       GROUP BY 1
       ORDER BY min(t.txn_date) ${query.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`,
      filter.params,
    );
    const row = counts.rows[0];
    return {
      all: Number(row.all_rows),
      needsReview: Number(row.needs_review),
      unclassified: Number(row.unclassified),
      months: months.rows.map((item) => ({ month: item.month || "Undated", count: Number(item.n) })),
    };
  });
}

export async function getTransaction(userId: string, clientId: string, id: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT ${TXN_SELECT}
       FROM bank_transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN statements s ON s.id = t.statement_id
       JOIN bank_accounts b ON b.id = s.bank_account_id
       WHERE t.id = $1 AND t.client_id = $2`,
      [id, clientId],
    );
    if (!rows.rowCount) return null;
    const audit = await db.query(
      `SELECT action, actor, diff, at FROM audit_log
       WHERE entity = 'bank_transaction' AND entity_id = $1
       ORDER BY at DESC`,
      [id],
    );
    const corrections = await db.query(
      `SELECT field, old_value, new_value, saved_as_rule, created_at, user_id
       FROM corrections WHERE bank_transaction_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return {
      ...mapTxn(rows.rows[0]),
      audit: audit.rows,
      corrections: corrections.rows.map((item) => ({
        field: item.field,
        oldValue: item.old_value,
        newValue: item.new_value,
        savedAsRule: item.saved_as_rule,
        at: item.created_at,
        userId: item.user_id,
      })),
    };
  });
}

export async function neighbors(userId: string, clientId: string, id: string, query: TxnQuery) {
  const filter = where(query, clientId);
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `WITH ordered AS (
         SELECT t.id, row_number() OVER (ORDER BY ${filter.order}) AS n
         FROM bank_transactions t
         WHERE ${filter.sql}
       )
       SELECT
         (SELECT id FROM ordered WHERE n = current.n - 1) AS prev,
         (SELECT id FROM ordered WHERE n = current.n + 1) AS next
       FROM ordered current
       WHERE current.id = $${filter.params.length + 1}`,
      [...filter.params, id],
    );
    return { prev: rows.rows[0]?.prev ?? null, next: rows.rows[0]?.next ?? null };
  });
}

const EDITABLE: Record<string, string> = {
  descriptionClean: "description_clean",
  counterparty: "counterparty",
  categoryId: "category_id",
  txnDate: "txn_date",
  debitMinor: "debit_minor",
  creditMinor: "credit_minor",
  balanceMinor: "balance_minor",
  reviewStatus: "review_status",
  reference: "reference",
};

export async function patchTransaction(userId: string, clientId: string, id: string, body: Record<string, unknown>) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    const current = await db.query(`SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`, [id, clientId]);
    if (!current.rowCount) return { error: "not_found" as const };
    const row = current.rows[0];
    const firm = await db.query(`SELECT firm_id FROM users WHERE id = $1`, [userId]);
    const changes: { field: string; column: string; value: unknown; old: string | null }[] = [];
    for (const [key, column] of Object.entries(EDITABLE)) {
      if (!(key in body)) continue;
      let value = body[key];
      if (key.endsWith("Minor")) value = assertMinor(value);
      const old = row[column] == null ? null : String(row[column]);
      const next = value == null ? null : String(value);
      if (old === next) continue;
      changes.push({ field: key, column, value, old });
    }
    if (!changes.length) return { ok: true, changed: 0 };
    const sets = changes.map((change, index) => `${change.column} = $${index + 3}`);
    const classSet = changes.some((change) => change.field === "categoryId") ? ", class_status = 'confirmed'" : "";
    await db.query(
      `UPDATE bank_transactions SET ${sets.join(", ")}${classSet} WHERE id = $1 AND client_id = $2`,
      [id, clientId, ...changes.map((change) => change.value)],
    );
    for (const change of changes) {
      await db.query(
        `INSERT INTO corrections (client_id, bank_transaction_id, field, old_value, new_value, user_id, saved_as_rule)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [clientId, id, change.field, change.old, change.value == null ? null : String(change.value), userId],
      );
    }
    await db.query(
      `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
       VALUES ($1,$2,'bank_transaction',$3,'correct',$4,$5)`,
      [firm.rows[0].firm_id, clientId, id, userId, JSON.stringify(Object.fromEntries(changes.map((change) => [change.field, change.value])))],
    );
    return { ok: true, changed: changes.length };
  });
}

export async function bulkCategorize(
  userId: string,
  clientId: string,
  categoryId: string,
  ids: string[] | null,
  query: TxnQuery | null,
) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    const firm = await db.query(`SELECT firm_id FROM users WHERE id = $1`, [userId]);
    let idList = ids ?? [];
    if (query) {
      const filter = where(query, clientId);
      const found = await db.query(`SELECT t.id FROM bank_transactions t WHERE ${filter.sql}`, filter.params);
      idList = found.rows.map((row) => row.id);
    }
    if (!idList.length) return { ok: true, updated: 0 };
    await db.query(
      `INSERT INTO corrections (client_id, bank_transaction_id, field, old_value, new_value, user_id, saved_as_rule)
       SELECT client_id, id, 'categoryId', category_id::text, $3, $4, false
       FROM bank_transactions
       WHERE client_id = $1 AND id = ANY($2::uuid[]) AND category_id IS DISTINCT FROM $3::uuid`,
      [clientId, idList, categoryId, userId],
    );
    const updated = await db.query(
      `UPDATE bank_transactions
       SET category_id = $3, class_status = 'confirmed'
       WHERE client_id = $1 AND id = ANY($2::uuid[])
       RETURNING id`,
      [clientId, idList, categoryId],
    );
    await db.query(
      `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
       VALUES ($1,$2,'bank_transaction',NULL,'bulk_categorize',$3,$4)`,
      [firm.rows[0].firm_id, clientId, userId, JSON.stringify({ count: updated.rowCount, categoryId })],
    );
    return { ok: true, updated: updated.rowCount };
  });
}

export async function exportTransactions(userId: string, clientId: string, query: TxnQuery) {
  const filter = where({ ...query, offset: 0, limit: undefined }, clientId);
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT ${TXN_SELECT}
       FROM bank_transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN statements s ON s.id = t.statement_id
       JOIN bank_accounts b ON b.id = s.bank_account_id
       WHERE ${filter.sql}
       ORDER BY ${filter.order}`,
      filter.params,
    );
    const header = [
      "Reference",
      "Date",
      "Description",
      "Counterparty",
      "Debit",
      "Credit",
      "Balance",
      "Category",
      "Classification",
      "Review",
      "Match",
      "Flags",
      "Confidence",
      "Statement",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows.rows.map(mapTxn)) {
      lines.push(
        [
          row.reference || `Row ${row.rowNo}`,
          row.txnDate || "",
          row.descriptionClean || row.descriptionRaw,
          row.counterparty || "",
          formatMinor(row.debitMinor),
          formatMinor(row.creditMinor),
          formatMinor(row.balanceMinor),
          row.categoryName || "",
          row.classStatus,
          row.reviewStatus,
          "Unmatched",
          row.flags.join(" "),
          row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`,
          row.statementLabel,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return lines.join("\n") + "\n";
  });
}

export async function sourceFor(userId: string, clientId: string, id: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT t.source_page, t.source_bbox, p.storage_key, p.width, p.height
       FROM bank_transactions t
       LEFT JOIN statement_pages p ON p.statement_id = t.statement_id AND p.page_no = t.source_page
       WHERE t.id = $1 AND t.client_id = $2`,
      [id, clientId],
    );
    if (!rows.rowCount) return null;
    return rows.rows[0] as {
      source_page: number | null;
      source_bbox: Record<string, number> | null;
      storage_key: string | null;
      width: number | null;
      height: number | null;
    };
  });
}

export async function categories(userId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(`SELECT id, name FROM categories ORDER BY name`);
    return rows.rows;
  });
}

export async function rules(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT r.id, r.match_type, r.pattern, r.priority, r.active, r.version, c.name AS category_name, r.category_id
       FROM rules r
       JOIN categories c ON c.id = r.category_id
       WHERE r.client_id IS NULL OR r.client_id = $1
       ORDER BY r.priority, r.created_at`,
      [clientId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      matchType: row.match_type,
      pattern: row.pattern,
      priority: row.priority,
      active: row.active,
      version: row.version,
      categoryId: row.category_id,
      categoryName: row.category_name,
    }));
  });
}

export async function createRule(
  userId: string,
  clientId: string,
  input: { matchType: string; pattern: string; categoryId: string; transactionId?: string },
) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    if (!["contains", "regex", "exact"].includes(input.matchType) || !input.pattern.trim()) {
      return { error: "bad_request" as const };
    }
    const firm = await db.query(`SELECT firm_id FROM users WHERE id = $1`, [userId]);
    const created = await db.query(
      `INSERT INTO rules (firm_id, client_id, match_type, pattern, category_id, priority, active)
       VALUES ($1, NULL, $2, $3, $4, 100, true)
       RETURNING id`,
      [firm.rows[0].firm_id, input.matchType, input.pattern.trim(), input.categoryId],
    );
    if (input.transactionId) {
      await db.query(
        `INSERT INTO corrections (client_id, bank_transaction_id, field, old_value, new_value, user_id, saved_as_rule)
         SELECT $1, id, 'rule', NULL, $3, $4, true
         FROM bank_transactions WHERE id = $2 AND client_id = $1`,
        [clientId, input.transactionId, input.pattern.trim(), userId],
      );
    }
    await db.query(
      `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor, diff)
       VALUES ($1,$2,'rule',$3,'rule_created',$4,$5)`,
      [firm.rows[0].firm_id, clientId, created.rows[0].id, userId, JSON.stringify({ pattern: input.pattern.trim(), matchType: input.matchType })],
    );
    return { id: created.rows[0].id as string };
  });
}

export async function disableRule(userId: string, clientId: string, id: string) {
  return withUser(userId, async (db) => {
    if (!(await canWrite(db, userId))) return { error: "forbidden" as const };
    const firm = await db.query(`SELECT firm_id FROM users WHERE id = $1`, [userId]);
    await db.query(`UPDATE rules SET active = false WHERE id = $1 AND firm_id = $2`, [id, firm.rows[0].firm_id]);
    await db.query(
      `INSERT INTO audit_log (firm_id, client_id, entity, entity_id, action, actor)
       VALUES ($1,$2,'rule',$3,'rule_disabled',$4)`,
      [firm.rows[0].firm_id, clientId, id, userId],
    );
    return { ok: true };
  });
}

export async function listViews(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, name, config FROM saved_views WHERE user_id = $1 AND client_id = $2 ORDER BY created_at`,
      [userId, clientId],
    );
    return rows.rows;
  });
}

export async function saveView(userId: string, clientId: string, name: string, config: unknown) {
  return withUser(userId, async (db) => {
    const created = await db.query(
      `INSERT INTO saved_views (client_id, user_id, name, config) VALUES ($1,$2,$3,$4) RETURNING id`,
      [clientId, userId, name, JSON.stringify(config)],
    );
    return { id: created.rows[0].id as string };
  });
}

export async function deleteView(userId: string, clientId: string, id: string) {
  return withUser(userId, async (db) => {
    await db.query(`DELETE FROM saved_views WHERE id = $1 AND user_id = $2 AND client_id = $3`, [id, userId, clientId]);
    return { ok: true };
  });
}

async function canWrite(db: PoolClient, userId: string) {
  const role = await db.query(`SELECT role FROM users WHERE id = $1`, [userId]);
  return ["admin", "accountant"].includes(role.rows[0]?.role);
}

function mapStatement(row: Record<string, unknown>) {
  const flags = (row.validation_flags as string[]) || [];
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    extractionMethod: row.extraction_method,
    pageCount: row.page_count,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingMinor: row.opening_minor,
    closingMinor: row.closing_minor,
    currency: row.currency,
    validationFlags: flags,
    balanceCheck: flags.includes("closing_mismatch")
      ? "failed"
      : row.status === "needs_review"
        ? "review"
        : "passed",
    proposedMapping: row.proposed_mapping,
    extractedRowCount: row.extracted_row_count,
    createdAt: row.created_at,
    bankName: row.bank_name,
    accountLabel: row.account_label,
    ibanMasked: row.iban_masked,
    fileName: row.original_name,
    mime: row.detected_mime,
    size: row.size,
    sha256: row.sha256,
  };
}

function mapTxn(row: Record<string, unknown>) {
  const period = row.period_start ? String(row.period_start).slice(0, 7) : "Statement";
  return {
    id: row.id as string,
    rowNo: row.row_no as number,
    reference: (row.reference as string | null) ?? null,
    txnDate: (row.txn_date as string | null) ?? null,
    valueDate: (row.value_date as string | null) ?? null,
    descriptionRaw: row.description_raw as string,
    descriptionClean: row.description_clean as string,
    counterparty: (row.counterparty as string | null) ?? null,
    debitMinor: (row.debit_minor as number | null) ?? null,
    creditMinor: (row.credit_minor as number | null) ?? null,
    balanceMinor: (row.balance_minor as number | null) ?? null,
    currency: row.currency as string,
    categoryId: (row.category_id as string | null) ?? null,
    categoryName: (row.category_name as string | null) ?? null,
    classStatus: row.class_status as string,
    reviewStatus: row.review_status as string,
    flags: (row.flags as string[]) || [],
    confidence: row.extraction_confidence == null ? null : Number(row.extraction_confidence),
    statementId: row.statement_id as string,
    statementLabel: `${row.bank_name} · ${period}`,
    sourcePage: (row.source_page as number | null) ?? null,
    sourceBbox: row.source_bbox,
  };
}

