import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { dualControlRequired, markVatPacksStale } from "@/server/release";
import { buildFinancialStatements } from "@/server/statements";

/** Demo UAE CT headline rate (fils math). Not a filing engine. */
export const CT_RATE_BPS = Number(process.env.CT_RATE_BPS || "900"); // 9.00%

export type CtAdjustment = {
  id: string;
  direction: "ADD_BACK" | "DEDUCT";
  amountMinor: number;
  reason: string;
  sourceRef: string;
};

export type CtReport = {
  kind: "CT";
  periodId: string;
  periodLabel: string;
  accountingProfitMinor: number;
  ledgerNetIncomeMinor: number;
  reconciledToLedger: boolean;
  adjustments: CtAdjustment[];
  addBacksMinor: number;
  deductsMinor: number;
  taxableIncomeMinor: number;
  rateBps: number;
  ctPayableMinor: number;
  ruleVersion: string;
  note: string;
};

export function computeCtPayable(taxableIncomeMinor: number, rateBps = CT_RATE_BPS) {
  if (taxableIncomeMinor <= 0) return 0;
  return Math.floor((taxableIncomeMinor * rateBps) / 10000);
}

export function hashCtPayload(payload: CtReport) {
  const canonical = JSON.stringify({
    kind: payload.kind,
    periodId: payload.periodId,
    accountingProfitMinor: payload.accountingProfitMinor,
    adjustments: payload.adjustments.map((a) => ({
      direction: a.direction,
      amountMinor: a.amountMinor,
      reason: a.reason,
    })),
    taxableIncomeMinor: payload.taxableIncomeMinor,
    ctPayableMinor: payload.ctPayableMinor,
    rateBps: payload.rateBps,
    ruleVersion: payload.ruleVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function buildCtReport(db: PoolClient, clientId: string, periodId: string): Promise<CtReport> {
  const statements = await buildFinancialStatements(db, clientId, periodId);
  const accountingProfitMinor = statements.retainedEarnings.yearEndClosed
    ? statements.retainedEarnings.netIncomeMinor
    : statements.pnl.netIncomeMinor;
  const ledgerNetIncomeMinor = accountingProfitMinor;

  const rows = await db.query(
    `SELECT id, direction, amount_minor AS "amountMinor", reason, source_ref AS "sourceRef"
     FROM ct_adjustments
     WHERE client_id = $1 AND period_id = $2
     ORDER BY created_at`,
    [clientId, periodId],
  );
  const adjustments = rows.rows.map((row) => ({
    id: String(row.id),
    direction: row.direction as "ADD_BACK" | "DEDUCT",
    amountMinor: Number(row.amountMinor),
    reason: String(row.reason),
    sourceRef: String(row.sourceRef || ""),
  }));
  const addBacksMinor = adjustments
    .filter((a) => a.direction === "ADD_BACK")
    .reduce((s, a) => s + a.amountMinor, 0);
  const deductsMinor = adjustments
    .filter((a) => a.direction === "DEDUCT")
    .reduce((s, a) => s + a.amountMinor, 0);
  const taxableIncomeMinor = accountingProfitMinor + addBacksMinor - deductsMinor;
  const ctPayableMinor = computeCtPayable(taxableIncomeMinor);

  return {
    kind: "CT",
    periodId: statements.period.id,
    periodLabel: statements.period.label,
    accountingProfitMinor,
    ledgerNetIncomeMinor,
    reconciledToLedger: accountingProfitMinor === ledgerNetIncomeMinor,
    adjustments,
    addBacksMinor,
    deductsMinor,
    taxableIncomeMinor,
    rateBps: CT_RATE_BPS,
    ctPayableMinor,
    ruleVersion: "ct-demo-v1",
    note: "Computation report only — arnibooks never submits to the FTA. Approve before download.",
  };
}

export async function getCtReport(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => buildCtReport(db, clientId, periodId));
}

export async function listCtAdjustments(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, direction, amount_minor AS "amountMinor", reason,
              source_ref AS "sourceRef", created_at AS "createdAt"
       FROM ct_adjustments
       WHERE client_id = $1 AND period_id = $2
       ORDER BY created_at`,
      [clientId, periodId],
    );
    return rows.rows;
  });
}

export async function addCtAdjustment(
  userId: string,
  clientId: string,
  body: {
    periodId: string;
    direction: "ADD_BACK" | "DEDUCT";
    amountMinor: number;
    reason: string;
    sourceRef?: string;
  },
) {
  return withUser(userId, async (db) => {
    if (!Number.isInteger(body.amountMinor) || body.amountMinor <= 0) {
      throw new LedgerError("invalid_money", "invalid_money");
    }
    if (!body.reason?.trim()) throw new LedgerError("reason_required", "bad_request");
    const period = await db.query(
      `SELECT id, status FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [body.periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
    const id = randomUUID();
    await db.query(
      `INSERT INTO ct_adjustments (
         id, client_id, period_id, direction, amount_minor, reason, source_ref, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        clientId,
        body.periodId,
        body.direction,
        body.amountMinor,
        body.reason.trim(),
        body.sourceRef || "",
        userId,
      ],
    );
    await markVatPacksStale(db, clientId, body.periodId);
    return { id, status: "created" };
  });
}

export async function deleteCtAdjustment(userId: string, clientId: string, adjustmentId: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `DELETE FROM ct_adjustments
       WHERE id = $1 AND client_id = $2
       RETURNING period_id`,
      [adjustmentId, clientId],
    );
    if (!row.rowCount) throw new LedgerError("adjustment_not_found", "not_found");
    await markVatPacksStale(db, clientId, row.rows[0].period_id);
    return { ok: true };
  });
}

export async function prepareCtPack(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const payload = await buildCtReport(db, clientId, periodId);
    if (!payload.reconciledToLedger) {
      throw new LedgerError("ct_not_reconcilable_to_ledger", "conflict");
    }
    const contentHash = hashCtPayload(payload);
    const versionRow = await db.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM release_packs
       WHERE client_id = $1 AND period_id = $2 AND kind = 'CT'`,
      [clientId, periodId],
    );
    const version = Number(versionRow.rows[0].next);
    const id = randomUUID();
    await db.query(
      `INSERT INTO release_packs (
         id, client_id, period_id, kind, version, status, content_hash, payload_json, prepared_by
       ) VALUES ($1,$2,$3,'CT',$4,'PENDING_APPROVAL',$5,$6::jsonb,$7)`,
      [id, clientId, periodId, version, contentHash, JSON.stringify(payload), userId],
    );
    await db.query(
      `INSERT INTO pack_approvals (id, pack_id, client_id, actor_id, role, content_hash)
       VALUES ($1,$2,$3,$4,'preparer',$5)`,
      [randomUUID(), id, clientId, userId, contentHash],
    );
    return {
      id,
      version,
      status: "PENDING_APPROVAL",
      contentHash,
      ctPayableMinor: payload.ctPayableMinor,
      dualControlRequired: dualControlRequired(),
    };
  });
}

export async function approveCtPack(userId: string, clientId: string, packId: string) {
  return withUser(userId, async (db) => {
    const pack = await db.query(
      `SELECT id, period_id, status, content_hash, prepared_by
       FROM release_packs WHERE id = $1 AND client_id = $2 AND kind = 'CT'`,
      [packId, clientId],
    );
    if (!pack.rowCount) throw new LedgerError("pack_not_found", "not_found");
    const row = pack.rows[0];
    if (row.status === "STALE") throw new LedgerError("pack_stale", "conflict");
    if (row.status === "RELEASED") throw new LedgerError("already_released", "conflict");
    if (row.status !== "PENDING_APPROVAL" && row.status !== "DRAFT") {
      throw new LedgerError("pack_not_approvable", "conflict");
    }

    const live = await buildCtReport(db, clientId, row.period_id);
    if (!live.reconciledToLedger) throw new LedgerError("ct_not_reconcilable_to_ledger", "conflict");
    const liveHash = hashCtPayload(live);
    if (liveHash !== row.content_hash) {
      await db.query(`UPDATE release_packs SET status = 'STALE' WHERE id = $1`, [packId]);
      throw new LedgerError("pack_stale_hash_mismatch", "conflict");
    }
    if (dualControlRequired() && String(row.prepared_by) === String(userId)) {
      throw new LedgerError("preparer_cannot_approve", "forbidden");
    }

    await db.query(
      `UPDATE release_packs
       SET status = 'RELEASED', approved_by = $2, approved_at = now(), released_at = now(),
           payload_json = $3::jsonb
       WHERE id = $1`,
      [packId, userId, JSON.stringify(live)],
    );
    await db.query(
      `INSERT INTO pack_approvals (id, pack_id, client_id, actor_id, role, content_hash)
       VALUES ($1,$2,$3,$4,'approver',$5)`,
      [randomUUID(), packId, clientId, userId, liveHash],
    );
    return { id: packId, status: "RELEASED", contentHash: liveHash };
  });
}

export async function downloadCtPack(
  userId: string,
  clientId: string,
  packId: string,
  meta?: { ipHash?: string | null; userAgent?: string | null },
) {
  return withUser(userId, async (db) => {
    const pack = await db.query(
      `SELECT id, status, version, content_hash, payload_json, prepared_at, approved_at, released_at
       FROM release_packs WHERE id = $1 AND client_id = $2 AND kind = 'CT'`,
      [packId, clientId],
    );
    if (!pack.rowCount) throw new LedgerError("pack_not_found", "not_found");
    const row = pack.rows[0];
    if (String(row.status) !== "RELEASED") {
      throw new LedgerError("download_requires_released", "forbidden");
    }
    const eventId = randomUUID();
    await db.query(
      `INSERT INTO download_events (id, pack_id, client_id, user_id, ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [eventId, packId, clientId, userId, meta?.ipHash || null, meta?.userAgent || null],
    );
    return {
      eventId,
      packId,
      version: row.version,
      status: row.status,
      contentHash: row.content_hash,
      releasedAt: row.released_at,
      preparedAt: row.prepared_at,
      approvedAt: row.approved_at,
      payload: row.payload_json,
      note: "Approve-before-download satisfied. File CT outside arnibooks — product never submits.",
    };
  });
}
