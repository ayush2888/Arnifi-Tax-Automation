import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";

/** Dual-control (preparer ≠ approver) is mandatory for the first 90 days of Stage B. */
export const DUAL_CONTROL_DAYS = 90;

export type Vat201Box = { taxableMinor: number; vatMinor: number };

export type Vat201Payload = {
  kind: "VAT201";
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  boxes: Record<string, Vat201Box>;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  journalEntryIds: string[];
  ruleVersion: string;
};

export function dualControlRequired(now = new Date()) {
  const until = process.env.DUAL_CONTROL_UNTIL;
  if (until) return now < new Date(until);
  // Default: enforce for Stage B demos (first 90 days from a fixed feature epoch).
  const epoch = new Date(process.env.DUAL_CONTROL_EPOCH || "2026-10-01T00:00:00.000Z");
  const ms = DUAL_CONTROL_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() < epoch.getTime() + ms;
}

export function hashVat201Payload(payload: Vat201Payload) {
  const canonical = JSON.stringify({
    kind: payload.kind,
    periodId: payload.periodId,
    boxes: payload.boxes,
    totalOutputVat: payload.totalOutputVat,
    totalInputVat: payload.totalInputVat,
    netPayable: payload.netPayable,
    journalEntryIds: [...payload.journalEntryIds].sort(),
    ruleVersion: payload.ruleVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function buildVat201Payload(
  db: PoolClient,
  clientId: string,
  periodId: string,
): Promise<Vat201Payload> {
  const period = await db.query(
    `SELECT id, label, period_start AS "periodStart", period_end AS "periodEnd", status
     FROM accounting_periods WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");

  const journals = await db.query(
    `SELECT id FROM journal_entries
     WHERE client_id = $1 AND period_id = $2 AND status = 'posted'
     ORDER BY id`,
    [clientId, periodId],
  );
  const journalEntryIds = journals.rows.map((row) => String(row.id));

  const fromDocs = await db.query(
    `SELECT d.doc_type,
            COALESCE((e.facts_json->>'taxableMinor')::bigint, 0) AS taxable,
            COALESCE((e.facts_json->>'vatMinor')::bigint, 0) AS vat
     FROM documents d
     JOIN document_extractions e ON e.document_id = d.id AND e.status = 'approved'
     WHERE d.client_id = $1 AND d.period_id = $2 AND d.status = 'posted'`,
    [clientId, periodId],
  );
  const boxes: Record<string, Vat201Box> = {};
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
  if (outVat || outTaxable) boxes["1b"] = { taxableMinor: outTaxable, vatMinor: outVat };
  if (inVat || inTaxable) boxes["9"] = { taxableMinor: inTaxable, vatMinor: inVat };

  // Fallback: VAT control lines when no document facts.
  if (!Object.keys(boxes).length) {
    const rows = await db.query(
      `SELECT COALESCE(l.vat201_box, a.vat201_box) AS box,
              COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
              COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted'
         AND COALESCE(l.vat201_box, a.vat201_box) IS NOT NULL
       GROUP BY 1`,
      [clientId, periodId],
    );
    for (const row of rows.rows) {
      const box = String(row.box);
      boxes[box] =
        box === "9"
          ? { taxableMinor: 0, vatMinor: Number(row.debitMinor) }
          : { taxableMinor: 0, vatMinor: Number(row.creditMinor) };
    }
  }

  const totalOutputVat = Object.entries(boxes)
    .filter(([box]) => box !== "9" && box !== "10")
    .reduce((sum, [, v]) => sum + v.vatMinor, 0);
  const totalInputVat = (boxes["9"]?.vatMinor || 0) + (boxes["10"]?.vatMinor || 0);

  return {
    kind: "VAT201",
    periodId,
    periodLabel: period.rows[0].label,
    periodStart: period.rows[0].periodStart,
    periodEnd: period.rows[0].periodEnd,
    boxes,
    totalOutputVat,
    totalInputVat,
    netPayable: totalOutputVat - totalInputVat,
    journalEntryIds,
    ruleVersion: "vat201-demo-v1",
  };
}

export async function markVatPacksStale(
  db: PoolClient,
  clientId: string,
  periodId: string,
) {
  await db.query(
    `UPDATE release_packs
     SET status = 'STALE', released_at = NULL
     WHERE client_id = $1
       AND period_id = $2
       AND kind IN ('VAT201', 'STATEMENTS', 'CT')
       AND status IN ('DRAFT', 'PENDING_APPROVAL', 'RELEASED')`,
    [clientId, periodId],
  );
}

function mapPack(row: Record<string, unknown>) {
  return {
    id: row.id,
    periodId: row.periodId ?? row.period_id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    contentHash: row.contentHash ?? row.content_hash,
    payload: row.payload ?? row.payload_json,
    preparedBy: row.preparedBy ?? row.prepared_by,
    preparedAt: row.preparedAt ?? row.prepared_at,
    approvedBy: row.approvedBy ?? row.approved_by,
    approvedAt: row.approvedAt ?? row.approved_at,
    releasedAt: row.releasedAt ?? row.released_at,
    preparerName: row.preparerName,
    approverName: row.approverName,
  };
}

export async function listReleasePacks(userId: string, clientId: string, periodId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT p.id, p.period_id AS "periodId", p.kind, p.version, p.status,
              p.content_hash AS "contentHash", p.payload_json AS payload,
              p.prepared_by AS "preparedBy", p.prepared_at AS "preparedAt",
              p.approved_by AS "approvedBy", p.approved_at AS "approvedAt",
              p.released_at AS "releasedAt",
              prep.name AS "preparerName",
              appr.name AS "approverName"
       FROM release_packs p
       JOIN users prep ON prep.id = p.prepared_by
       LEFT JOIN users appr ON appr.id = p.approved_by
       WHERE p.client_id = $1
         AND ($2::uuid IS NULL OR p.period_id = $2)
       ORDER BY p.period_id, p.kind, p.version DESC`,
      [clientId, periodId || null],
    );
    return rows.rows.map(mapPack);
  });
}

export async function getReleasePack(userId: string, clientId: string, packId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT p.id, p.period_id AS "periodId", p.kind, p.version, p.status,
              p.content_hash AS "contentHash", p.payload_json AS payload,
              p.prepared_by AS "preparedBy", p.prepared_at AS "preparedAt",
              p.approved_by AS "approvedBy", p.approved_at AS "approvedAt",
              p.released_at AS "releasedAt",
              prep.name AS "preparerName",
              appr.name AS "approverName"
       FROM release_packs p
       JOIN users prep ON prep.id = p.prepared_by
       LEFT JOIN users appr ON appr.id = p.approved_by
       WHERE p.id = $1 AND p.client_id = $2`,
      [packId, clientId],
    );
    return rows.rowCount ? mapPack(rows.rows[0]) : null;
  });
}

export async function prepareVat201Pack(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const payload = await buildVat201Payload(db, clientId, periodId);
    const contentHash = hashVat201Payload(payload);
    const versionRow = await db.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM release_packs
       WHERE client_id = $1 AND period_id = $2 AND kind = 'VAT201'`,
      [clientId, periodId],
    );
    const version = Number(versionRow.rows[0].next);
    const id = randomUUID();
    await db.query(
      `INSERT INTO release_packs (
         id, client_id, period_id, kind, version, status, content_hash, payload_json, prepared_by
       ) VALUES ($1,$2,$3,'VAT201',$4,'PENDING_APPROVAL',$5,$6::jsonb,$7)`,
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
      payload,
      dualControlRequired: dualControlRequired(),
    };
  });
}

export async function approveVat201Pack(userId: string, clientId: string, packId: string) {
  return withUser(userId, async (db) => {
    const pack = await db.query(
      `SELECT id, period_id, status, content_hash, prepared_by, payload_json
       FROM release_packs WHERE id = $1 AND client_id = $2 AND kind = 'VAT201'`,
      [packId, clientId],
    );
    if (!pack.rowCount) throw new LedgerError("pack_not_found", "not_found");
    const row = pack.rows[0];
    if (row.status === "STALE") throw new LedgerError("pack_stale", "conflict");
    if (row.status === "RELEASED") throw new LedgerError("already_released", "conflict");
    if (row.status !== "PENDING_APPROVAL" && row.status !== "DRAFT") {
      throw new LedgerError("pack_not_approvable", "conflict");
    }

    const live = await buildVat201Payload(db, clientId, row.period_id);
    const liveHash = hashVat201Payload(live);
    if (liveHash !== row.content_hash) {
      await db.query(`UPDATE release_packs SET status = 'STALE' WHERE id = $1`, [packId]);
      throw new LedgerError("pack_stale_hash_mismatch", "conflict");
    }

    if (dualControlRequired() && String(row.prepared_by) === String(userId)) {
      throw new LedgerError("preparer_cannot_approve", "forbidden");
    }

    await db.query(
      `UPDATE release_packs
       SET status = 'RELEASED',
           approved_by = $2,
           approved_at = now(),
           released_at = now(),
           payload_json = $3::jsonb
       WHERE id = $1`,
      [packId, userId, JSON.stringify(live)],
    );
    await db.query(
      `INSERT INTO pack_approvals (id, pack_id, client_id, actor_id, role, content_hash)
       VALUES ($1,$2,$3,$4,'approver',$5)`,
      [randomUUID(), packId, clientId, userId, liveHash],
    );
    return {
      id: packId,
      status: "RELEASED",
      contentHash: liveHash,
      approvedBy: userId,
      dualControlRequired: dualControlRequired(),
    };
  });
}

export async function downloadVat201Pack(
  userId: string,
  clientId: string,
  packId: string,
  meta?: { ipHash?: string | null; userAgent?: string | null },
) {
  return withUser(userId, async (db) => {
    const pack = await db.query(
      `SELECT id, status, version, content_hash, payload_json, prepared_at, approved_at, released_at
       FROM release_packs WHERE id = $1 AND client_id = $2 AND kind = 'VAT201'`,
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
      note: "File in the FTA portal outside arnibooks. This product never submits.",
    };
  });
}

export async function listDownloadEvents(userId: string, clientId: string, packId?: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT d.id, d.pack_id AS "packId", d.user_id AS "userId", d.at,
              d.ip_hash AS "ipHash", u.name AS "userName",
              p.version, p.status AS "packStatus"
       FROM download_events d
       JOIN users u ON u.id = d.user_id
       JOIN release_packs p ON p.id = d.pack_id
       WHERE d.client_id = $1
         AND ($2::uuid IS NULL OR d.pack_id = $2)
       ORDER BY d.at DESC
       LIMIT 100`,
      [clientId, packId || null],
    );
    return rows.rows;
  });
}
