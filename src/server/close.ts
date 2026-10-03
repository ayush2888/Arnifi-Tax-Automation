import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { markVatPacksStale } from "@/server/release";
import { controlCheck } from "@/server/recon";
import { trialBalance } from "@/server/ledger";

async function requirePostablePeriod(db: PoolClient, clientId: string, periodId: string) {
  const period = await db.query(
    `SELECT id, status, label, period_start, period_end
     FROM accounting_periods WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
  if (!["OPEN", "REOPENED"].includes(period.rows[0].status)) {
    throw new LedgerError("period_closed", "period_closed");
  }
  return period.rows[0];
}

async function postBalancedJournal(
  db: PoolClient,
  args: {
    userId: string;
    clientId: string;
    periodId: string;
    memo: string;
    entryDate: string;
    lines: { accountId: string; debitMinor?: number; creditMinor?: number }[];
  },
) {
  let debit = 0;
  let credit = 0;
  for (const line of args.lines) {
    debit += line.debitMinor ?? 0;
    credit += line.creditMinor ?? 0;
  }
  if (debit !== credit || debit <= 0) throw new LedgerError("journal_unbalanced", "journal_unbalanced");

  const entryId = randomUUID();
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ memo: args.memo, entryDate: args.entryDate, lines: args.lines }))
    .digest("hex");
  await db.query(
    `INSERT INTO journal_entries (
       id, client_id, period_id, memo, entry_date, status, content_hash, created_by, posted_at
     ) VALUES ($1,$2,$3,$4,$5,'posted',$6,$7,now())`,
    [entryId, args.clientId, args.periodId, args.memo, args.entryDate, contentHash, args.userId],
  );
  for (const line of args.lines) {
    await db.query(
      `INSERT INTO journal_lines (
         id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, line_memo
       ) VALUES ($1,$2,$3,$4,$5,$6,'AED',$7)`,
      [
        randomUUID(),
        entryId,
        args.clientId,
        line.accountId,
        line.debitMinor ?? 0,
        line.creditMinor ?? 0,
        args.memo,
      ],
    );
  }
  await markVatPacksStale(db, args.clientId, args.periodId);
  return entryId;
}

export async function listAccruals(userId: string, clientId: string, periodId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT a.id, a.period_id AS "periodId", a.kind, a.memo, a.amount_minor AS "amountMinor",
              a.auto_reverse AS "autoReverse", a.status, a.journal_entry_id AS "journalEntryId",
              d.code AS "debitCode", c.code AS "creditCode"
       FROM accrual_schedules a
       JOIN chart_accounts d ON d.id = a.debit_account_id
       JOIN chart_accounts c ON c.id = a.credit_account_id
       WHERE a.client_id = $1 AND ($2::uuid IS NULL OR a.period_id = $2)
       ORDER BY a.created_at DESC`,
      [clientId, periodId || null],
    );
    return rows.rows;
  });
}

export async function createAccrual(
  userId: string,
  clientId: string,
  body: {
    periodId: string;
    kind: "ACCRUAL" | "PREPAYMENT";
    memo: string;
    debitAccountId: string;
    creditAccountId: string;
    amountMinor: number;
    autoReverse?: boolean;
  },
) {
  return withUser(userId, async (db) => {
    await requirePostablePeriod(db, clientId, body.periodId);
    if (!Number.isInteger(body.amountMinor) || body.amountMinor <= 0) {
      throw new LedgerError("invalid_money", "invalid_money");
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO accrual_schedules (
         id, client_id, period_id, kind, memo, debit_account_id, credit_account_id,
         amount_minor, auto_reverse, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10)`,
      [
        id,
        clientId,
        body.periodId,
        body.kind,
        body.memo || "",
        body.debitAccountId,
        body.creditAccountId,
        body.amountMinor,
        body.autoReverse !== false,
        userId,
      ],
    );
    return { id, status: "DRAFT" };
  });
}

export async function postAccrual(userId: string, clientId: string, accrualId: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `SELECT * FROM accrual_schedules WHERE id = $1 AND client_id = $2`,
      [accrualId, clientId],
    );
    if (!row.rowCount) throw new LedgerError("accrual_not_found", "not_found");
    const accrual = row.rows[0];
    if (accrual.status === "POSTED") return { id: accrualId, status: "POSTED", journalEntryId: accrual.journal_entry_id };
    if (accrual.status === "WAIVED") throw new LedgerError("accrual_waived", "conflict");
    await requirePostablePeriod(db, clientId, accrual.period_id);
    const period = await db.query(`SELECT period_end FROM accounting_periods WHERE id = $1`, [accrual.period_id]);
    const entryId = await postBalancedJournal(db, {
      userId,
      clientId,
      periodId: accrual.period_id,
      memo: `${accrual.kind} ${accrual.memo}`.trim(),
      entryDate: period.rows[0].period_end,
      lines: [
        { accountId: accrual.debit_account_id, debitMinor: Number(accrual.amount_minor) },
        { accountId: accrual.credit_account_id, creditMinor: Number(accrual.amount_minor) },
      ],
    });
    await db.query(
      `UPDATE accrual_schedules
       SET status = 'POSTED', journal_entry_id = $2, posted_at = now()
       WHERE id = $1`,
      [accrualId, entryId],
    );
    return { id: accrualId, status: "POSTED", journalEntryId: entryId };
  });
}

export async function waiveAccrual(userId: string, clientId: string, accrualId: string, reason: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `UPDATE accrual_schedules
       SET status = 'WAIVED'
       WHERE id = $1 AND client_id = $2 AND status IN ('DRAFT', 'PROPOSED')
       RETURNING id, period_id`,
      [accrualId, clientId],
    );
    if (!row.rowCount) throw new LedgerError("accrual_not_waivable", "conflict");
    await db.query(
      `INSERT INTO period_close_events (id, client_id, period_id, action, actor_id, reason, checklist_json)
       VALUES ($1,$2,$3,'WAIVE',$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        clientId,
        row.rows[0].period_id,
        userId,
        reason || "accrual waived",
        JSON.stringify({ accrualId }),
      ],
    );
    return { id: accrualId, status: "WAIVED" };
  });
}

export function monthlyStraightLineMinor(costMinor: number, residualMinor: number, lifeMonths: number) {
  if (lifeMonths <= 0) throw new LedgerError("bad_life_months", "bad_request");
  const depreciable = costMinor - residualMinor;
  if (depreciable <= 0) throw new LedgerError("bad_asset_cost", "bad_request");
  return Math.floor(depreciable / lifeMonths);
}

export async function listFixedAssets(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, code, name, cost_minor AS "costMinor", residual_minor AS "residualMinor",
              life_months AS "lifeMonths", method, in_service_on AS "inServiceOn", status
       FROM fixed_assets WHERE client_id = $1 ORDER BY code`,
      [clientId],
    );
    return rows.rows;
  });
}

export async function registerFixedAsset(
  userId: string,
  clientId: string,
  body: {
    code: string;
    name: string;
    costMinor: number;
    residualMinor?: number;
    lifeMonths: number;
    inServiceOn: string;
    assetAccountId: string;
    accumDeprAccountId: string;
    deprExpenseAccountId: string;
    periodId: string;
  },
) {
  return withUser(userId, async (db) => {
    await requirePostablePeriod(db, clientId, body.periodId);
    const monthly = monthlyStraightLineMinor(body.costMinor, body.residualMinor || 0, body.lifeMonths);
    const assetId = randomUUID();
    await db.query(
      `INSERT INTO fixed_assets (
         id, client_id, code, name, cost_minor, residual_minor, life_months, method,
         in_service_on, asset_account_id, accum_depr_account_id, depr_expense_account_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'STRAIGHT_LINE',$8,$9,$10,$11,'ACTIVE')`,
      [
        assetId,
        clientId,
        body.code,
        body.name,
        body.costMinor,
        body.residualMinor || 0,
        body.lifeMonths,
        body.inServiceOn,
        body.assetAccountId,
        body.accumDeprAccountId,
        body.deprExpenseAccountId,
      ],
    );
    // Capitalize: Dr FA / Cr Bank (demo assumption — cash purchase).
    await postBalancedJournal(db, {
      userId,
      clientId,
      periodId: body.periodId,
      memo: `FA purchase ${body.code}`,
      entryDate: body.inServiceOn,
      lines: [
        { accountId: body.assetAccountId, debitMinor: body.costMinor },
        {
          accountId: (
            await db.query(`SELECT id FROM chart_accounts WHERE client_id = $1 AND is_bank LIMIT 1`, [clientId])
          ).rows[0].id,
          creditMinor: body.costMinor,
        },
      ],
    });
    const schedId = randomUUID();
    await db.query(
      `INSERT INTO depreciation_schedules (
         id, client_id, asset_id, period_id, amount_minor, status
       ) VALUES ($1,$2,$3,$4,$5,'PLANNED')`,
      [schedId, clientId, assetId, body.periodId, monthly],
    );
    return { id: assetId, monthlyDeprMinor: monthly, depreciationScheduleId: schedId };
  });
}

export async function listDepreciation(userId: string, clientId: string, periodId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT d.id, d.period_id AS "periodId", d.amount_minor AS "amountMinor", d.status,
              d.journal_entry_id AS "journalEntryId",
              a.code AS "assetCode", a.name AS "assetName"
       FROM depreciation_schedules d
       JOIN fixed_assets a ON a.id = d.asset_id
       WHERE d.client_id = $1 AND ($2::uuid IS NULL OR d.period_id = $2)
       ORDER BY a.code`,
      [clientId, periodId || null],
    );
    return rows.rows;
  });
}

export async function postDepreciation(userId: string, clientId: string, scheduleId: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `SELECT d.*, a.depr_expense_account_id, a.accum_depr_account_id, a.code
       FROM depreciation_schedules d
       JOIN fixed_assets a ON a.id = d.asset_id
       WHERE d.id = $1 AND d.client_id = $2`,
      [scheduleId, clientId],
    );
    if (!row.rowCount) throw new LedgerError("depr_not_found", "not_found");
    const sched = row.rows[0];
    if (sched.status === "POSTED") return { id: scheduleId, status: "POSTED", journalEntryId: sched.journal_entry_id };
    if (sched.status === "WAIVED") throw new LedgerError("depr_waived", "conflict");
    await requirePostablePeriod(db, clientId, sched.period_id);
    const period = await db.query(`SELECT period_end FROM accounting_periods WHERE id = $1`, [sched.period_id]);
    const entryId = await postBalancedJournal(db, {
      userId,
      clientId,
      periodId: sched.period_id,
      memo: `Depreciation ${sched.code}`,
      entryDate: period.rows[0].period_end,
      lines: [
        { accountId: sched.depr_expense_account_id, debitMinor: Number(sched.amount_minor) },
        { accountId: sched.accum_depr_account_id, creditMinor: Number(sched.amount_minor) },
      ],
    });
    await db.query(
      `UPDATE depreciation_schedules
       SET status = 'POSTED', journal_entry_id = $2, posted_at = now()
       WHERE id = $1`,
      [scheduleId, entryId],
    );
    return { id: scheduleId, status: "POSTED", journalEntryId: entryId };
  });
}

export async function closeChecklist(userId: string, clientId: string, periodId: string) {
  const tb = await trialBalance(userId, clientId, periodId);
  let recon: Awaited<ReturnType<typeof controlCheck>> | null = null;
  try {
    recon = await controlCheck(userId, clientId, periodId);
  } catch {
    recon = null;
  }

  return withUser(userId, async (db) => {
    const period = await db.query(
      `SELECT id, label, status, period_start AS "periodStart", period_end AS "periodEnd"
       FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");

    const accruals = await db.query(
      `SELECT status FROM accrual_schedules WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
    const openAccruals = accruals.rows.filter((row) => !["POSTED", "WAIVED", "REVERSED"].includes(row.status));
    const depr = await db.query(
      `SELECT status FROM depreciation_schedules WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
    const openDepr = depr.rows.filter((row) => !["POSTED", "WAIVED"].includes(row.status));

    const vat = await db.query(
      `SELECT status FROM release_packs
       WHERE client_id = $1 AND period_id = $2 AND kind = 'VAT201'
       ORDER BY version DESC LIMIT 1`,
      [clientId, periodId],
    );
    const vatWaive = await db.query(
      `SELECT 1 FROM period_close_events
       WHERE client_id = $1 AND period_id = $2 AND action = 'WAIVE'
         AND checklist_json->>'vat' = 'waived'
       LIMIT 1`,
      [clientId, periodId],
    );
    const reconWaive = await db.query(
      `SELECT 1 FROM period_close_events
       WHERE client_id = $1 AND period_id = $2 AND action = 'WAIVE'
         AND checklist_json->>'recon' = 'waived'
       LIMIT 1`,
      [clientId, periodId],
    );
    const vatOk = vat.rows[0]?.status === "RELEASED" || Boolean(vatWaive.rowCount) || !vat.rowCount;
    const reconOk = Boolean(reconWaive.rowCount) || (recon ? Boolean(recon.balanced) : true);

    const items = {
      tbBalanced: Boolean(tb.balanced),
      reconBalanced: reconOk,
      accrualsSettled: openAccruals.length === 0,
      depreciationSettled: openDepr.length === 0,
      vatReleasedOrWaived: vatOk,
    };
    const ready = Object.values(items).every(Boolean);
    return {
      period: period.rows[0],
      trialBalance: { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, balanced: tb.balanced },
      recon: recon
        ? { balanced: recon.balanced, ar: recon.ar, ap: recon.ap }
        : { balanced: true, note: "recon tables unavailable or empty" },
      items,
      ready,
    };
  });
}

export async function waiveVatForClose(userId: string, clientId: string, periodId: string, reason: string) {
  return withUser(userId, async (db) => {
    await db.query(
      `INSERT INTO period_close_events (id, client_id, period_id, action, actor_id, reason, checklist_json)
       VALUES ($1,$2,$3,'WAIVE',$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        clientId,
        periodId,
        userId,
        reason || "VAT pack waived for close",
        JSON.stringify({ vat: "waived" }),
      ],
    );
    return { ok: true };
  });
}

export async function waiveReconForClose(userId: string, clientId: string, periodId: string, reason: string) {
  return withUser(userId, async (db) => {
    await db.query(
      `INSERT INTO period_close_events (id, client_id, period_id, action, actor_id, reason, checklist_json)
       VALUES ($1,$2,$3,'WAIVE',$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        clientId,
        periodId,
        userId,
        reason || "Recon waived for close",
        JSON.stringify({ recon: "waived" }),
      ],
    );
    return { ok: true };
  });
}

export async function closePeriod(userId: string, clientId: string, periodId: string, reason = "") {
  const checklist = await closeChecklist(userId, clientId, periodId);
  if (!checklist.ready) throw new LedgerError("close_checklist_incomplete", "conflict");
  if (checklist.period.status === "CLOSED") throw new LedgerError("already_closed", "conflict");

  return withUser(userId, async (db) => {
    await db.query(
      `UPDATE accounting_periods
       SET status = 'CLOSED', closed_at = now(), closed_by = $3
       WHERE id = $1 AND client_id = $2`,
      [periodId, clientId, userId],
    );
    await db.query(
      `INSERT INTO period_close_events (id, client_id, period_id, action, actor_id, reason, checklist_json)
       VALUES ($1,$2,$3,'CLOSE',$4,$5,$6::jsonb)`,
      [randomUUID(), clientId, periodId, userId, reason || "period closed", JSON.stringify(checklist.items)],
    );
    return { id: periodId, status: "CLOSED", checklist: checklist.items };
  });
}

export async function reopenPeriod(
  userId: string,
  clientId: string,
  periodId: string,
  body: { reason: string; ticketRef?: string },
) {
  if (!body.reason?.trim()) throw new LedgerError("reopen_reason_required", "bad_request");
  return withUser(userId, async (db) => {
    const period = await db.query(
      `SELECT id, status FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
    if (period.rows[0].status !== "CLOSED") throw new LedgerError("period_not_closed", "conflict");

    await db.query(
      `UPDATE accounting_periods
       SET status = 'REOPENED', reopened_at = now(), reopened_by = $3
       WHERE id = $1 AND client_id = $2`,
      [periodId, clientId, userId],
    );
    await markVatPacksStale(db, clientId, periodId);
    await db.query(
      `INSERT INTO period_close_events (id, client_id, period_id, action, actor_id, reason, ticket_ref, checklist_json)
       VALUES ($1,$2,$3,'REOPEN',$4,$5,$6,'{}'::jsonb)`,
      [randomUUID(), clientId, periodId, userId, body.reason.trim(), body.ticketRef || ""],
    );
    return { id: periodId, status: "REOPENED" };
  });
}

export async function listCloseEvents(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT e.id, e.action, e.reason, e.ticket_ref AS "ticketRef", e.at,
              e.checklist_json AS checklist, u.name AS "actorName"
       FROM period_close_events e
       JOIN users u ON u.id = e.actor_id
       WHERE e.client_id = $1 AND e.period_id = $2
       ORDER BY e.at DESC`,
      [clientId, periodId],
    );
    return rows.rows;
  });
}
