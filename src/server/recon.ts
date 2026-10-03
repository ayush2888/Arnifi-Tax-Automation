import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { markVatPacksStale } from "@/server/release";

/** Exact fils match by default; env can widen for fee/FX later. */
export const RECON_TOLERANCE_MINOR = Number(process.env.RECON_TOLERANCE_MINOR || "0");

export function withinTolerance(left: number, right: number, tolerance = RECON_TOLERANCE_MINOR) {
  return Math.abs(left - right) <= tolerance;
}

export async function ensureParty(
  db: PoolClient,
  clientId: string,
  name: string,
  partyType: "customer" | "supplier" | "other",
) {
  const trimmed = name.trim() || "Unknown";
  const existing = await db.query(
    `SELECT id FROM parties WHERE client_id = $1 AND name = $2 AND party_type = $3`,
    [clientId, trimmed, partyType],
  );
  if (existing.rowCount) return existing.rows[0].id as string;
  const id = randomUUID();
  await db.query(
    `INSERT INTO parties (id, client_id, name, party_type) VALUES ($1,$2,$3,$4)`,
    [id, clientId, trimmed, partyType],
  );
  return id;
}

export async function createOpenItemFromInvoice(
  db: PoolClient,
  args: {
    clientId: string;
    periodId: string;
    side: "AR" | "AP";
    partyName: string;
    documentId: string;
    journalEntryId: string;
    journalLineId: string;
    reference: string;
    amountMinor: number;
    openedOn: string;
  },
) {
  const partyId = await ensureParty(
    db,
    args.clientId,
    args.partyName,
    args.side === "AR" ? "customer" : "supplier",
  );
  const id = randomUUID();
  await db.query(
    `INSERT INTO open_items (
       id, client_id, period_id, party_id, side, document_id, journal_entry_id, journal_line_id,
       reference, original_minor, outstanding_minor, currency, opened_on, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,'AED',$11,'OPEN')`,
    [
      id,
      args.clientId,
      args.periodId,
      partyId,
      args.side,
      args.documentId,
      args.journalEntryId,
      args.journalLineId,
      args.reference,
      args.amountMinor,
      args.openedOn,
    ],
  );
  return id;
}

export async function listOpenItems(
  userId: string,
  clientId: string,
  opts?: { side?: "AR" | "AP"; status?: string; periodId?: string },
) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT o.id, o.side, o.reference, o.original_minor AS "originalMinor",
              o.outstanding_minor AS "outstandingMinor", o.status, o.opened_on AS "openedOn",
              o.period_id AS "periodId", o.document_id AS "documentId",
              p.name AS "partyName", p.party_type AS "partyType"
       FROM open_items o
       JOIN parties p ON p.id = o.party_id
       WHERE o.client_id = $1
         AND ($2::text IS NULL OR o.side = $2)
         AND ($3::text IS NULL OR o.status = $3)
         AND ($4::uuid IS NULL OR o.period_id = $4)
       ORDER BY o.opened_on DESC, o.created_at DESC`,
      [clientId, opts?.side || null, opts?.status || null, opts?.periodId || null],
    );
    return rows.rows;
  });
}

export async function controlCheck(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const period = await db.query(
      `SELECT id, label FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");

    const controls = await db.query(
      `SELECT id, code, name, is_ar, is_ap
       FROM chart_accounts
       WHERE client_id = $1 AND active AND (is_ar OR is_ap)`,
      [clientId],
    );
    const ar = controls.rows.find((row) => row.is_ar);
    const ap = controls.rows.find((row) => row.is_ap);
    if (!ar || !ap) throw new LedgerError("coa_incomplete", "coa_incomplete");

    const controlBalance = async (accountId: string) => {
      const row = await db.query(
        `SELECT COALESCE(SUM(l.debit_minor), 0)::bigint AS debit,
                COALESCE(SUM(l.credit_minor), 0)::bigint AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted' AND l.account_id = $3`,
        [clientId, periodId, accountId],
      );
      return Number(row.rows[0].debit) - Number(row.rows[0].credit);
    };

    const arControl = await controlBalance(ar.id);
    const apControl = await controlBalance(ap.id); // credit-normal → negative net; use credit - debit for liability

    const sub = await db.query(
      `SELECT side,
              COALESCE(SUM(outstanding_minor), 0)::bigint AS outstanding
       FROM open_items
       WHERE client_id = $1 AND period_id = $2 AND status IN ('OPEN', 'PARTIAL')
       GROUP BY side`,
      [clientId, periodId],
    );
    const arSub = Number(sub.rows.find((r) => r.side === "AR")?.outstanding || 0);
    const apSub = Number(sub.rows.find((r) => r.side === "AP")?.outstanding || 0);

    const arControlOutstanding = arControl; // debit balance
    const apControlOutstanding = -apControl; // convert signed net to AP outstanding

    const arOk = withinTolerance(arSub, arControlOutstanding);
    const apOk = withinTolerance(apSub, apControlOutstanding);

    return {
      period: period.rows[0],
      toleranceMinor: RECON_TOLERANCE_MINOR,
      ar: {
        subledgerMinor: arSub,
        controlMinor: arControlOutstanding,
        deltaMinor: arSub - arControlOutstanding,
        balanced: arOk,
      },
      ap: {
        subledgerMinor: apSub,
        controlMinor: apControlOutstanding,
        deltaMinor: apSub - apControlOutstanding,
        balanced: apOk,
      },
      balanced: arOk && apOk,
    };
  });
}

async function bankAmount(db: PoolClient, clientId: string, txnId: string) {
  const row = await db.query(
    `SELECT id, debit_minor, credit_minor, description_clean, txn_date
     FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [txnId, clientId],
  );
  if (!row.rowCount) throw new LedgerError("bank_txn_not_found", "not_found");
  const debit = Number(row.rows[0].debit_minor || 0);
  const credit = Number(row.rows[0].credit_minor || 0);
  return {
    id: txnId,
    amountMinor: debit > 0 ? debit : credit,
    direction: debit > 0 ? ("debit" as const) : ("credit" as const),
    row: row.rows[0],
  };
}

export async function proposeMatch(
  userId: string,
  clientId: string,
  body: {
    periodId?: string | null;
    bankTransactionIds: string[];
    openItemIds: string[];
    note?: string;
  },
) {
  return withUser(userId, async (db) => {
    const bankIds = body.bankTransactionIds || [];
    const openIds = body.openItemIds || [];
    if (!bankIds.length || !openIds.length) {
      throw new LedgerError("match_requires_both_sides", "bad_request");
    }

    let bankTotal = 0;
    const bankLegs: { id: string; amountMinor: number }[] = [];
    for (const id of bankIds) {
      const txn = await bankAmount(db, clientId, id);
      bankTotal += txn.amountMinor;
      bankLegs.push({ id, amountMinor: txn.amountMinor });
    }

    let openTotal = 0;
    const openLegs: { id: string; amountMinor: number; outstanding: number }[] = [];
    for (const id of openIds) {
      const item = await db.query(
        `SELECT id, outstanding_minor, status FROM open_items
         WHERE id = $1 AND client_id = $2`,
        [id, clientId],
      );
      if (!item.rowCount) throw new LedgerError("open_item_not_found", "not_found");
      if (item.rows[0].status === "CLEARED") throw new LedgerError("open_item_cleared", "conflict");
      const outstanding = Number(item.rows[0].outstanding_minor);
      openTotal += outstanding;
      openLegs.push({ id, amountMinor: outstanding, outstanding });
    }

    const exact = withinTolerance(bankTotal, openTotal);
    const partial = !exact && bankTotal < openTotal;
    if (!exact && !partial) {
      throw new LedgerError("match_out_of_tolerance", "bad_request");
    }
    if (partial && (bankIds.length !== 1 || openIds.length !== 1)) {
      throw new LedgerError("partial_requires_one_to_one", "bad_request");
    }

    const matchKind =
      bankIds.length === 1 && openIds.length === 1
        ? partial
          ? "PARTIAL"
          : "ONE_TO_ONE"
        : bankIds.length === 1
          ? "ONE_TO_MANY"
          : openIds.length === 1
            ? "MANY_TO_ONE"
            : "ONE_TO_MANY";

    const groupId = randomUUID();
    await db.query(
      `INSERT INTO recon_groups (
         id, client_id, period_id, status, match_kind, note, created_by
       ) VALUES ($1,$2,$3,'PROPOSED',$4,$5,$6)`,
      [groupId, clientId, body.periodId || null, matchKind, body.note || "", userId],
    );

    for (const leg of bankLegs) {
      await db.query(
        `INSERT INTO recon_legs (id, group_id, client_id, leg_kind, bank_transaction_id, amount_minor)
         VALUES ($1,$2,$3,'BANK_TXN',$4,$5)`,
        [randomUUID(), groupId, clientId, leg.id, leg.amountMinor],
      );
    }
    for (const leg of openLegs) {
      const amount = partial ? bankTotal : leg.amountMinor;
      await db.query(
        `INSERT INTO recon_legs (id, group_id, client_id, leg_kind, open_item_id, amount_minor)
         VALUES ($1,$2,$3,'OPEN_ITEM',$4,$5)`,
        [randomUUID(), groupId, clientId, leg.id, amount],
      );
    }

    return { id: groupId, status: "PROPOSED", matchKind, bankTotal, openTotal: partial ? bankTotal : openTotal };
  });
}

async function postSettlementJournal(
  db: PoolClient,
  args: {
    userId: string;
    clientId: string;
    periodId: string;
    side: "AR" | "AP";
    amountMinor: number;
    openItemId: string;
    reference: string;
  },
) {
  const coa = await db.query(
    `SELECT id, is_ar, is_ap, is_bank
     FROM chart_accounts WHERE client_id = $1 AND active`,
    [args.clientId],
  );
  const ar = coa.rows.find((row) => row.is_ar);
  const ap = coa.rows.find((row) => row.is_ap);
  const bank = coa.rows.find((row) => row.is_bank);
  if (!ar || !ap || !bank) throw new LedgerError("coa_incomplete", "coa_incomplete");

  const entryId = randomUUID();
  const memo = `Settlement ${args.side} ${args.reference}`.trim();
  const entryDate = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO journal_entries (
       id, client_id, period_id, memo, entry_date, status, created_by, posted_at
     ) VALUES ($1,$2,$3,$4,$5,'posted',$6,now())`,
    [entryId, args.clientId, args.periodId, memo, entryDate, args.userId],
  );

  const lines =
    args.side === "AR"
      ? [
          { accountId: bank.id, debitMinor: args.amountMinor, creditMinor: 0 },
          { accountId: ar.id, debitMinor: 0, creditMinor: args.amountMinor },
        ]
      : [
          { accountId: ap.id, debitMinor: args.amountMinor, creditMinor: 0 },
          { accountId: bank.id, debitMinor: 0, creditMinor: args.amountMinor },
        ];
  for (const line of lines) {
    await db.query(
      `INSERT INTO journal_lines (
         id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, line_memo
       ) VALUES ($1,$2,$3,$4,$5,$6,'AED',$7)`,
      [randomUUID(), entryId, args.clientId, line.accountId, line.debitMinor, line.creditMinor, memo],
    );
  }
  await markVatPacksStale(db, args.clientId, args.periodId);
  return entryId;
}

export async function confirmMatch(userId: string, clientId: string, groupId: string) {
  return withUser(userId, async (db) => {
    const group = await db.query(
      `SELECT id, status, period_id FROM recon_groups WHERE id = $1 AND client_id = $2`,
      [groupId, clientId],
    );
    if (!group.rowCount) throw new LedgerError("recon_group_not_found", "not_found");
    if (group.rows[0].status === "CONFIRMED") return { id: groupId, status: "CONFIRMED" };
    if (group.rows[0].status !== "PROPOSED") throw new LedgerError("recon_not_proposed", "conflict");

    const legs = await db.query(
      `SELECT leg_kind, open_item_id, amount_minor
       FROM recon_legs WHERE group_id = $1 AND client_id = $2`,
      [groupId, clientId],
    );
    for (const leg of legs.rows) {
      if (leg.leg_kind !== "OPEN_ITEM") continue;
      const item = await db.query(
        `SELECT id, side, outstanding_minor, period_id, reference
         FROM open_items WHERE id = $1 AND client_id = $2 FOR UPDATE`,
        [leg.open_item_id, clientId],
      );
      if (!item.rowCount) throw new LedgerError("open_item_not_found", "not_found");
      const outstanding = Number(item.rows[0].outstanding_minor);
      const apply = Number(leg.amount_minor);
      if (apply > outstanding) throw new LedgerError("open_item_over_applied", "conflict");
      const periodId = group.rows[0].period_id || item.rows[0].period_id;
      await postSettlementJournal(db, {
        userId,
        clientId,
        periodId,
        side: item.rows[0].side,
        amountMinor: apply,
        openItemId: item.rows[0].id,
        reference: item.rows[0].reference,
      });
      const next = outstanding - apply;
      await db.query(
        `UPDATE open_items
         SET outstanding_minor = $2::bigint,
             status = CASE
               WHEN $2::bigint = 0 THEN 'CLEARED'
               WHEN $2::bigint < original_minor THEN 'PARTIAL'
               ELSE status
             END
         WHERE id = $1`,
        [leg.open_item_id, next],
      );
    }

    await db.query(
      `UPDATE recon_groups
       SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now()
       WHERE id = $1`,
      [groupId, userId],
    );
    return { id: groupId, status: "CONFIRMED" };
  });
}

export async function listReconGroups(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, period_id AS "periodId", status, match_kind AS "matchKind",
              note, created_at AS "createdAt", confirmed_at AS "confirmedAt"
       FROM recon_groups
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [clientId],
    );
    return rows.rows;
  });
}

export async function listUnmatchedBank(userId: string, clientId: string, limit = 50) {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT t.id, t.txn_date AS "txnDate", t.description_clean AS description,
              t.debit_minor AS "debitMinor", t.credit_minor AS "creditMinor", t.currency
       FROM bank_transactions t
       WHERE t.client_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM recon_legs l
           JOIN recon_groups g ON g.id = l.group_id
           WHERE l.bank_transaction_id = t.id
             AND g.status IN ('PROPOSED', 'CONFIRMED')
         )
       ORDER BY t.txn_date DESC NULLS LAST
       LIMIT $2`,
      [clientId, limit],
    );
    return rows.rows;
  });
}

export async function createException(
  userId: string,
  clientId: string,
  body: {
    kind: "UNMATCHED_BANK" | "UNMATCHED_OPEN_ITEM" | "CONTROL_BREAK" | "STALE" | "OTHER";
    message: string;
    periodId?: string | null;
    bankTransactionId?: string | null;
    openItemId?: string | null;
  },
) {
  return withUser(userId, async (db) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO recon_exceptions (
         id, client_id, period_id, kind, status, bank_transaction_id, open_item_id, message, created_by
       ) VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,$8)`,
      [
        id,
        clientId,
        body.periodId || null,
        body.kind,
        body.bankTransactionId || null,
        body.openItemId || null,
        body.message,
        userId,
      ],
    );
    return { id, status: "OPEN" };
  });
}

export async function listExceptions(userId: string, clientId: string, status = "OPEN") {
  return withUser(userId, async (db) => {
    const rows = await db.query(
      `SELECT id, kind, status, message, period_id AS "periodId",
              bank_transaction_id AS "bankTransactionId",
              open_item_id AS "openItemId",
              created_at AS "createdAt"
       FROM recon_exceptions
       WHERE client_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC
       LIMIT 100`,
      [clientId, status || null],
    );
    return rows.rows;
  });
}

export async function resolveException(userId: string, clientId: string, exceptionId: string) {
  return withUser(userId, async (db) => {
    const row = await db.query(
      `UPDATE recon_exceptions
       SET status = 'RESOLVED', resolved_by = $3, resolved_at = now()
       WHERE id = $1 AND client_id = $2 AND status = 'OPEN'
       RETURNING id, status`,
      [exceptionId, clientId, userId],
    );
    if (!row.rowCount) throw new LedgerError("exception_not_found", "not_found");
    return row.rows[0];
  });
}

/** Exact-amount auto proposals: bank credit ↔ AR open item, bank debit ↔ AP open item. */
export async function autoProposeExactMatches(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const open = await db.query(
      `SELECT id, side, outstanding_minor
       FROM open_items
       WHERE client_id = $1 AND period_id = $2 AND status IN ('OPEN', 'PARTIAL')
       ORDER BY opened_on`,
      [clientId, periodId],
    );
    const bank = await db.query(
      `SELECT t.id, t.debit_minor, t.credit_minor
       FROM bank_transactions t
       WHERE t.client_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM recon_legs l
           JOIN recon_groups g ON g.id = l.group_id
           WHERE l.bank_transaction_id = t.id AND g.status IN ('PROPOSED', 'CONFIRMED')
         )`,
      [clientId],
    );
    const usedBank = new Set<string>();
    const usedOpen = new Set<string>();
    const proposed: string[] = [];

    for (const item of open.rows) {
      if (usedOpen.has(item.id)) continue;
      const amount = Number(item.outstanding_minor);
      const wantCredit = item.side === "AR";
      const hit = bank.rows.find((txn) => {
        if (usedBank.has(txn.id)) return false;
        const debit = Number(txn.debit_minor || 0);
        const credit = Number(txn.credit_minor || 0);
        const amt = debit > 0 ? debit : credit;
        const isCredit = credit > 0;
        return amt === amount && isCredit === wantCredit;
      });
      if (!hit) continue;
      usedBank.add(hit.id);
      usedOpen.add(item.id);
      // inline propose without nested withUser
      const groupId = randomUUID();
      await db.query(
        `INSERT INTO recon_groups (
           id, client_id, period_id, status, match_kind, note, created_by
         ) VALUES ($1,$2,$3,'PROPOSED','ONE_TO_ONE','auto exact amount',$4)`,
        [groupId, clientId, periodId, userId],
      );
      await db.query(
        `INSERT INTO recon_legs (id, group_id, client_id, leg_kind, bank_transaction_id, amount_minor)
         VALUES ($1,$2,$3,'BANK_TXN',$4,$5)`,
        [randomUUID(), groupId, clientId, hit.id, amount],
      );
      await db.query(
        `INSERT INTO recon_legs (id, group_id, client_id, leg_kind, open_item_id, amount_minor)
         VALUES ($1,$2,$3,'OPEN_ITEM',$4,$5)`,
        [randomUUID(), groupId, clientId, item.id, amount],
      );
      proposed.push(groupId);
    }
    return { proposedCount: proposed.length, groupIds: proposed };
  });
}
