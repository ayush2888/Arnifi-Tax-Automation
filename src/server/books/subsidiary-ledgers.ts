import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { allowRealClientData } from "@/config/security";
import { withUser } from "@/lib/db";
import { writeBooksAudit } from "@/server/books/audit";
import { BooksError } from "@/server/books/errors";
import {
  buildStatement,
  isLedgerKind,
  isPartyType,
  LEDGER_KIND_META,
  LEDGER_KINDS,
  normalizePartyInput,
  summarizeAging,
  summarizeGroup,
  summarizeParties,
  UNASSIGNED_PARTY,
  type GroupBalanceRow,
  type LedgerKind,
  type PartyMovementRow,
  type StatementLineInput,
} from "@/server/books/subsidiary-ledger-core";
import { assertSyntheticTenant } from "@/server/security-gate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function parseKind(kind: unknown): LedgerKind {
  if (!isLedgerKind(kind)) throw new BooksError("ledger_kind_invalid", "invalid_ledger");
  return kind;
}

function accountFilterParams(kind: LedgerKind): { flag: string | null; subTypes: string[] } {
  const filter = LEDGER_KIND_META[kind].accountFilter;
  return "flag" in filter
    ? { flag: filter.flag, subTypes: [] }
    : { flag: null, subTypes: [...filter.subTypes] };
}

/** Parameterised account filter; flag is 'is_ar' | 'is_ap' | null and subTypes is text[]. */
function accountFilterSql(flagParam: number, subTypesParam: number) {
  return `(
  ($${flagParam}::text = 'is_ar' AND a.is_ar)
  OR ($${flagParam}::text = 'is_ap' AND a.is_ap)
  OR a.sub_type = ANY($${subTypesParam}::text[])
)`;
}

const ACCOUNT_FILTER_SQL = accountFilterSql(4, 5);

async function loadPeriod(db: PoolClient, clientId: string, periodId: string) {
  if (!isUuid(periodId)) throw new BooksError("period_not_found", "not_found");
  const period = await db.query(
    `SELECT id, label, period_start, period_end FROM books_periods
     WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!period.rowCount) throw new BooksError("period_not_found", "not_found");
  return {
    label: String(period.rows[0].label),
    start: String(period.rows[0].period_start),
    end: String(period.rows[0].period_end),
  };
}

export async function listBooksParties(
  userId: string,
  clientId: string,
  opts?: { partyType?: string; includeInactive?: boolean },
) {
  if (opts?.partyType && !isPartyType(opts.partyType)) {
    throw new BooksError("party_type_invalid", "invalid_party");
  }
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT id, name, party_type AS "partyType", trn, email, active
       FROM books_parties
       WHERE client_id = $1
         AND ($2::text IS NULL OR party_type = $2::text)
         AND ($3::boolean OR active)
       ORDER BY lower(name), party_type`,
      [clientId, opts?.partyType ?? null, Boolean(opts?.includeInactive)],
    );
    return rows.rows;
  });
}

export async function createBooksParty(
  userId: string,
  clientId: string,
  raw: { name?: unknown; partyType?: unknown; trn?: unknown; email?: unknown },
) {
  const input = normalizePartyInput(raw);
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const id = randomUUID();
    try {
      await db.query(
        `INSERT INTO books_parties (id, client_id, name, party_type, trn, email)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, clientId, input.name, input.partyType, input.trn, input.email],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new BooksError("party_exists", "conflict");
      if (code === "42501") throw new BooksError("forbidden", "forbidden");
      throw error;
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "create_party",
      entity: "books_party",
      entityId: id,
      after: { name: input.name, partyType: input.partyType },
    });
    return { id, ...input, active: true };
  });
}

/** Every party id on a journal line must belong to this client (inactive is fine so reversals still work). */
export async function assertPartiesBelongToClient(
  db: PoolClient,
  clientId: string,
  partyIds: Array<string | null | undefined>,
) {
  const unique = [...new Set(partyIds.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return;
  if (!unique.every(isUuid)) throw new BooksError("party_invalid", "invalid_party");
  const found = await db.query(
    `SELECT id FROM books_parties
     WHERE client_id = $1 AND id = ANY($2::uuid[])`,
    [clientId, unique],
  );
  if (found.rowCount !== unique.length) throw new BooksError("party_not_found", "not_found");
}

export async function subsidiaryLedgerSummary(
  userId: string,
  clientId: string,
  kindInput: string,
  periodId: string,
  opts?: { includeZero?: boolean },
) {
  const kind = parseKind(kindInput);
  const meta = LEDGER_KIND_META[kind];
  const filter = accountFilterParams(kind);
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await loadPeriod(db, clientId, periodId);

    const movement = await db.query(
      `SELECT l.party_id AS "partyId", p.name AS "partyName", p.party_type AS "partyType",
              COALESCE(SUM(CASE WHEN e.entry_date < $2::date THEN l.debit_minor ELSE 0 END), 0)::bigint AS "openingDebitMinor",
              COALESCE(SUM(CASE WHEN e.entry_date < $2::date THEN l.credit_minor ELSE 0 END), 0)::bigint AS "openingCreditMinor",
              COALESCE(SUM(CASE WHEN e.entry_date >= $2::date THEN l.debit_minor ELSE 0 END), 0)::bigint AS "periodDebitMinor",
              COALESCE(SUM(CASE WHEN e.entry_date >= $2::date THEN l.credit_minor ELSE 0 END), 0)::bigint AS "periodCreditMinor"
       FROM books_journal_lines l
       JOIN books_journal_entries e ON e.id = l.entry_id
         AND e.client_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.deleted_at IS NULL
         AND e.entry_date <= $3::date
       JOIN books_accounts a ON a.id = l.account_id AND a.client_id = $1 AND ${ACCOUNT_FILTER_SQL}
       LEFT JOIN books_parties p ON p.id = l.party_id
       WHERE l.client_id = $1
       GROUP BY l.party_id, p.name, p.party_type`,
      [clientId, period.start, period.end, filter.flag, filter.subTypes],
    );

    const accounts = await db.query(
      `SELECT a.id, a.code, a.name
       FROM books_accounts a
       WHERE a.client_id = $1 AND a.active AND ${accountFilterSql(2, 3)}
       ORDER BY a.code`,
      [clientId, filter.flag, filter.subTypes],
    );

    const summary = summarizeParties(movement.rows as PartyMovementRow[], meta.normalBalance, {
      includeZero: opts?.includeZero,
    });

    return {
      kind,
      label: meta.label,
      partyLabel: meta.partyLabel,
      normalBalance: meta.normalBalance,
      periodId,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      accounts: accounts.rows.map((r) => ({
        id: String(r.id),
        code: String(r.code),
        name: String(r.name),
      })),
      ...summary,
    };
  });
}

export async function subsidiaryLedgerStatement(
  userId: string,
  clientId: string,
  kindInput: string,
  periodId: string,
  partyKey: string,
) {
  const kind = parseKind(kindInput);
  const meta = LEDGER_KIND_META[kind];
  const filter = accountFilterParams(kind);
  const unassigned = partyKey === UNASSIGNED_PARTY;
  if (!unassigned && !isUuid(partyKey)) throw new BooksError("party_not_found", "not_found");

  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await loadPeriod(db, clientId, periodId);

    let party: { id: string | null; name: string; partyType: string | null; trn: string | null };
    if (unassigned) {
      party = { id: null, name: "Unassigned", partyType: null, trn: null };
    } else {
      const found = await db.query(
        `SELECT id, name, party_type AS "partyType", trn
         FROM books_parties WHERE id = $1 AND client_id = $2`,
        [partyKey, clientId],
      );
      if (!found.rowCount) throw new BooksError("party_not_found", "not_found");
      party = {
        id: String(found.rows[0].id),
        name: String(found.rows[0].name),
        partyType: String(found.rows[0].partyType),
        trn: found.rows[0].trn == null ? null : String(found.rows[0].trn),
      };
    }
    const partyId = party.id;

    const opening = await db.query(
      `SELECT COALESCE(SUM(l.debit_minor), 0)::bigint AS d, COALESCE(SUM(l.credit_minor), 0)::bigint AS c
       FROM books_journal_lines l
       JOIN books_journal_entries e ON e.id = l.entry_id
         AND e.client_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.deleted_at IS NULL
         AND e.entry_date < $2::date
       JOIN books_accounts a ON a.id = l.account_id AND a.client_id = $1 AND ${accountFilterSql(3, 4)}
       WHERE l.client_id = $1
         AND (CASE WHEN $5::boolean THEN l.party_id IS NULL ELSE l.party_id = $6::uuid END)`,
      [clientId, period.start, filter.flag, filter.subTypes, unassigned, partyId],
    );

    const lines = await db.query(
      `SELECT e.id AS "entryId", e.entry_no AS "entryNo", e.entry_date AS "entryDate",
              e.voucher_type AS "voucherType", e.reference,
              COALESCE(NULLIF(btrim(l.line_memo), ''), e.memo) AS memo,
              a.code AS "accountCode", a.name AS "accountName",
              l.debit_minor AS "debitMinor", l.credit_minor AS "creditMinor"
       FROM books_journal_lines l
       JOIN books_journal_entries e ON e.id = l.entry_id
         AND e.client_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.deleted_at IS NULL
         AND e.entry_date >= $2::date
         AND e.entry_date <= $3::date
       JOIN books_accounts a ON a.id = l.account_id AND a.client_id = $1 AND ${ACCOUNT_FILTER_SQL}
       WHERE l.client_id = $1
         AND (CASE WHEN $6::boolean THEN l.party_id IS NULL ELSE l.party_id = $7::uuid END)
       ORDER BY e.entry_date ASC, e.created_at ASC, l.id ASC`,
      [clientId, period.start, period.end, filter.flag, filter.subTypes, unassigned, partyId],
    );

    const statement = buildStatement(
      { debitMinor: Number(opening.rows[0].d), creditMinor: Number(opening.rows[0].c) },
      lines.rows.map(
        (r): StatementLineInput => ({
          entryId: String(r.entryId),
          entryNo: r.entryNo == null ? null : String(r.entryNo),
          entryDate: String(r.entryDate),
          voucherType: String(r.voucherType || ""),
          reference: String(r.reference || ""),
          memo: String(r.memo || ""),
          accountCode: String(r.accountCode),
          accountName: String(r.accountName),
          debitMinor: Number(r.debitMinor),
          creditMinor: Number(r.creditMinor),
        }),
      ),
      meta.normalBalance,
    );

    return {
      kind,
      label: meta.label,
      partyLabel: meta.partyLabel,
      normalBalance: meta.normalBalance,
      periodId,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      party,
      ...statement,
    };
  });
}

export async function updateBooksParty(
  userId: string,
  clientId: string,
  partyId: string,
  patch: { name?: unknown; partyType?: unknown; trn?: unknown; email?: unknown; active?: unknown },
) {
  if (!isUuid(partyId)) throw new BooksError("party_not_found", "not_found");
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const existing = await db.query(
      `SELECT name, party_type AS "partyType", trn, email, active
       FROM books_parties WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [partyId, clientId],
    );
    if (!existing.rowCount) throw new BooksError("party_not_found", "not_found");
    const before = existing.rows[0];
    const merged = normalizePartyInput({
      name: patch.name !== undefined ? patch.name : before.name,
      partyType: patch.partyType !== undefined ? patch.partyType : before.partyType,
      trn: patch.trn !== undefined ? patch.trn : before.trn,
      email: patch.email !== undefined ? patch.email : before.email,
    });
    const active = patch.active === undefined ? Boolean(before.active) : Boolean(patch.active);
    try {
      const res = await db.query(
        `UPDATE books_parties SET name = $3, party_type = $4, trn = $5, email = $6, active = $7
         WHERE id = $1 AND client_id = $2`,
        [partyId, clientId, merged.name, merged.partyType, merged.trn, merged.email, active],
      );
      // RLS hides rows the role may not write; zero rows updated means the role cannot edit.
      if (!res.rowCount) throw new BooksError("forbidden", "forbidden");
    } catch (error) {
      if (error instanceof BooksError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new BooksError("party_exists", "conflict");
      if (code === "42501") throw new BooksError("forbidden", "forbidden");
      throw error;
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "update_party",
      entity: "books_party",
      entityId: partyId,
      before: {
        name: before.name,
        partyType: before.partyType,
        trn: before.trn,
        email: before.email,
        active: before.active,
      },
      after: { ...merged, active },
    });
    return { id: partyId, ...merged, active };
  });
}

/** Aging of open items as of the period end. Settlements clear the oldest charges first. */
export async function subsidiaryLedgerAging(
  userId: string,
  clientId: string,
  kindInput: string,
  periodId: string,
) {
  const kind = parseKind(kindInput);
  const meta = LEDGER_KIND_META[kind];
  const filter = accountFilterParams(kind);
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await loadPeriod(db, clientId, periodId);
    const rows = await db.query(
      `SELECT l.party_id AS "partyId", p.name AS "partyName", p.party_type AS "partyType",
              e.entry_date AS date, l.debit_minor AS "debitMinor", l.credit_minor AS "creditMinor"
       FROM books_journal_lines l
       JOIN books_journal_entries e ON e.id = l.entry_id
         AND e.client_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.deleted_at IS NULL
         AND e.entry_date <= $2::date
       JOIN books_accounts a ON a.id = l.account_id AND a.client_id = $1 AND ${accountFilterSql(3, 4)}
       LEFT JOIN books_parties p ON p.id = l.party_id
       WHERE l.client_id = $1`,
      [clientId, period.end, filter.flag, filter.subTypes],
    );
    const byParty = new Map<
      string,
      {
        partyId: string | null;
        partyName: string | null;
        partyType: string | null;
        lines: { date: string; debitMinor: number; creditMinor: number }[];
      }
    >();
    for (const r of rows.rows) {
      const key = r.partyId ? String(r.partyId) : UNASSIGNED_PARTY;
      let entry = byParty.get(key);
      if (!entry) {
        entry = {
          partyId: r.partyId ? String(r.partyId) : null,
          partyName: r.partyName == null ? null : String(r.partyName),
          partyType: r.partyType == null ? null : String(r.partyType),
          lines: [],
        };
        byParty.set(key, entry);
      }
      entry.lines.push({
        date: String(r.date),
        debitMinor: Number(r.debitMinor),
        creditMinor: Number(r.creditMinor),
      });
    }
    return {
      kind,
      label: meta.label,
      partyLabel: meta.partyLabel,
      normalBalance: meta.normalBalance,
      periodId,
      periodLabel: period.label,
      ...summarizeAging([...byParty.values()], period.end, meta.normalBalance),
    };
  });
}

/** Closing balance per ledger kind for every company the user can see, as of a date. */
export async function groupLedgerOverview(userId: string, asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    throw new BooksError("as_of_invalid", "invalid_date");
  }
  return withUser(userId, async (db) => {
    const clients = await db.query(
      `SELECT id, name FROM clients
       WHERE ($1::boolean OR is_synthetic IS NOT FALSE)
         AND archived_at IS NULL
       ORDER BY name`,
      [allowRealClientData()],
    );
    const ids = clients.rows.map((c) => String(c.id));
    const rows: GroupBalanceRow[] = [];
    if (ids.length) {
      for (const kind of LEDGER_KINDS) {
        const filter = accountFilterParams(kind);
        const res = await db.query(
          `SELECT l.client_id AS "clientId",
                  COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
                  COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
           FROM books_journal_lines l
           JOIN books_journal_entries e ON e.id = l.entry_id
             AND e.client_id = l.client_id
             AND e.status IN ('posted', 'reversed')
             AND e.deleted_at IS NULL
             AND e.entry_date <= $2::date
           JOIN books_accounts a ON a.id = l.account_id AND a.client_id = l.client_id AND ${accountFilterSql(3, 4)}
           WHERE l.client_id = ANY($1::uuid[])
           GROUP BY l.client_id`,
          [ids, asOf, filter.flag, filter.subTypes],
        );
        for (const r of res.rows) {
          rows.push({
            clientId: String(r.clientId),
            clientName: "",
            kind,
            debitMinor: Number(r.debitMinor),
            creditMinor: Number(r.creditMinor),
          });
        }
      }
    }
    return {
      asOf,
      ledgers: LEDGER_KINDS.map((k) => ({ kind: k, label: LEDGER_KIND_META[k].label })),
      ...summarizeGroup(
        clients.rows.map((c) => ({ id: String(c.id), name: String(c.name) })),
        rows,
      ),
    };
  });
}
