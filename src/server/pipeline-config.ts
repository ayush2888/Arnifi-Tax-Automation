import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { assertSyntheticTenant } from "@/server/security-gate";

export type ClientProfile = {
  clientId: string;
  legalName: string;
  trn: string | null;
  baseCurrency: string;
  fyStartMonth: number;
  vatRegistered: boolean;
  vatPeriod: "monthly" | "quarterly";
  ctApplicable: boolean;
  ibansJson: unknown[];
};

export type SourceAccount = {
  id: string;
  clientId: string;
  kind: "bank" | "card" | "gateway" | "other";
  label: string;
  currency: string;
  coaAccountId: string | null;
  bankAccountId: string | null;
  externalRef: string | null;
  active: boolean;
};

export type PostingRule = {
  id: string;
  firmId: string | null;
  clientId: string | null;
  docType: string | null;
  vendorPattern: string | null;
  narrationRegex: string | null;
  itemPattern: string | null;
  lineFlag: "revenue" | "disbursement" | "expense" | "asset";
  vatTreatment: string;
  targetAccountCode: string | null;
  targetAccountId: string | null;
  priority: number;
  deferMonths: number;
  active: boolean;
};

export type FxRate = {
  id: string;
  clientId: string;
  rateDate: string;
  currency: string;
  rateToAedScaled: number;
};

function mapProfile(row: Record<string, unknown>): ClientProfile {
  return {
    clientId: String(row.clientId ?? row.client_id),
    legalName: String(row.legalName ?? row.legal_name),
    trn: (row.trn as string | null) ?? null,
    baseCurrency: String(row.baseCurrency ?? row.base_currency),
    fyStartMonth: Number(row.fyStartMonth ?? row.fy_start_month),
    vatRegistered: Boolean(row.vatRegistered ?? row.vat_registered),
    vatPeriod: (row.vatPeriod ?? row.vat_period) as "monthly" | "quarterly",
    ctApplicable: Boolean(row.ctApplicable ?? row.ct_applicable),
    ibansJson: (row.ibansJson ?? row.ibans_json ?? []) as unknown[],
  };
}

function mapSource(row: Record<string, unknown>): SourceAccount {
  return {
    id: String(row.id),
    clientId: String(row.clientId ?? row.client_id),
    kind: (row.kind as SourceAccount["kind"]) || "bank",
    label: String(row.label),
    currency: String(row.currency),
    coaAccountId: (row.coaAccountId ?? row.coa_account_id ?? null) as string | null,
    bankAccountId: (row.bankAccountId ?? row.bank_account_id ?? null) as string | null,
    externalRef: (row.externalRef ?? row.external_ref ?? null) as string | null,
    active: Boolean(row.active),
  };
}

function mapRule(row: Record<string, unknown>): PostingRule {
  return {
    id: String(row.id),
    firmId: (row.firmId ?? row.firm_id ?? null) as string | null,
    clientId: (row.clientId ?? row.client_id ?? null) as string | null,
    docType: (row.docType ?? row.doc_type ?? null) as string | null,
    vendorPattern: (row.vendorPattern ?? row.vendor_pattern ?? null) as string | null,
    narrationRegex: (row.narrationRegex ?? row.narration_regex ?? null) as string | null,
    itemPattern: (row.itemPattern ?? row.item_pattern ?? null) as string | null,
    lineFlag: (row.lineFlag ?? row.line_flag) as PostingRule["lineFlag"],
    vatTreatment: String(row.vatTreatment ?? row.vat_treatment),
    targetAccountCode: (row.targetAccountCode ?? row.target_account_code ?? null) as string | null,
    targetAccountId: (row.targetAccountId ?? row.target_account_id ?? null) as string | null,
    priority: Number(row.priority),
    deferMonths: Number(row.deferMonths ?? row.defer_months ?? 0),
    active: Boolean(row.active),
  };
}

async function firmIdForClient(db: PoolClient, clientId: string) {
  const row = await db.query(`SELECT firm_id AS "firmId" FROM clients WHERE id = $1`, [clientId]);
  if (!row.rowCount) throw new LedgerError("client_not_found", "not_found");
  return String(row.rows[0].firmId);
}

export async function getClientProfile(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    const visible = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
    if (!visible.rowCount) return null;
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `SELECT client_id AS "clientId", legal_name AS "legalName", trn,
              base_currency AS "baseCurrency", fy_start_month AS "fyStartMonth",
              vat_registered AS "vatRegistered", vat_period AS "vatPeriod",
              ct_applicable AS "ctApplicable", ibans_json AS "ibansJson"
       FROM client_profile WHERE client_id = $1`,
      [clientId],
    );
    return row.rowCount ? mapProfile(row.rows[0]) : null;
  });
}

export async function upsertClientProfile(
  userId: string,
  clientId: string,
  body: Partial<ClientProfile> & { legalName: string },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `INSERT INTO client_profile (
         client_id, legal_name, trn, base_currency, fy_start_month,
         vat_registered, vat_period, ct_applicable, ibans_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (client_id) DO UPDATE SET
         legal_name = EXCLUDED.legal_name,
         trn = EXCLUDED.trn,
         base_currency = EXCLUDED.base_currency,
         fy_start_month = EXCLUDED.fy_start_month,
         vat_registered = EXCLUDED.vat_registered,
         vat_period = EXCLUDED.vat_period,
         ct_applicable = EXCLUDED.ct_applicable,
         ibans_json = EXCLUDED.ibans_json,
         updated_at = now()
       RETURNING client_id AS "clientId", legal_name AS "legalName", trn,
                 base_currency AS "baseCurrency", fy_start_month AS "fyStartMonth",
                 vat_registered AS "vatRegistered", vat_period AS "vatPeriod",
                 ct_applicable AS "ctApplicable", ibans_json AS "ibansJson"`,
      [
        clientId,
        body.legalName,
        body.trn ?? null,
        body.baseCurrency || "AED",
        body.fyStartMonth ?? 1,
        body.vatRegistered ?? true,
        body.vatPeriod || "quarterly",
        body.ctApplicable ?? true,
        JSON.stringify(body.ibansJson ?? []),
      ],
    );
    return mapProfile(row.rows[0]);
  });
}

export async function listSourceAccounts(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT id, client_id AS "clientId", kind, label, currency,
              coa_account_id AS "coaAccountId", bank_account_id AS "bankAccountId",
              external_ref AS "externalRef", active
       FROM client_source_account
       WHERE client_id = $1
       ORDER BY kind, label`,
      [clientId],
    );
    return rows.rows.map(mapSource);
  });
}

export async function upsertSourceAccount(
  userId: string,
  clientId: string,
  body: {
    id?: string;
    kind: SourceAccount["kind"];
    label: string;
    currency?: string;
    coaAccountId?: string | null;
    bankAccountId?: string | null;
    externalRef?: string | null;
    active?: boolean;
  },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const id = body.id || randomUUID();
    const row = await db.query(
      `INSERT INTO client_source_account (
         id, client_id, kind, label, currency, coa_account_id, bank_account_id, external_ref, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         label = EXCLUDED.label,
         currency = EXCLUDED.currency,
         coa_account_id = EXCLUDED.coa_account_id,
         bank_account_id = EXCLUDED.bank_account_id,
         external_ref = EXCLUDED.external_ref,
         active = EXCLUDED.active
       RETURNING id, client_id AS "clientId", kind, label, currency,
                 coa_account_id AS "coaAccountId", bank_account_id AS "bankAccountId",
                 external_ref AS "externalRef", active`,
      [
        id,
        clientId,
        body.kind,
        body.label,
        body.currency || "AED",
        body.coaAccountId ?? null,
        body.bankAccountId ?? null,
        body.externalRef ?? null,
        body.active ?? true,
      ],
    );
    return mapSource(row.rows[0]);
  });
}

export async function listPostingRules(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const firmId = await firmIdForClient(db, clientId);
    const rows = await db.query(
      `SELECT id, firm_id AS "firmId", client_id AS "clientId", doc_type AS "docType",
              vendor_pattern AS "vendorPattern", narration_regex AS "narrationRegex",
              item_pattern AS "itemPattern", line_flag AS "lineFlag",
              vat_treatment AS "vatTreatment", target_account_code AS "targetAccountCode",
              target_account_id AS "targetAccountId", priority,
              defer_months AS "deferMonths", active
       FROM client_posting_rule
       WHERE active
         AND (client_id = $1 OR (client_id IS NULL AND firm_id = $2))
       ORDER BY
         CASE WHEN client_id IS NULL THEN 1 ELSE 0 END,
         priority ASC,
         created_at ASC`,
      [clientId, firmId],
    );
    return rows.rows.map(mapRule);
  });
}

/** Client rules beat firm defaults; lower priority number wins within the same scope. */
export function pickPostingRule(
  rules: PostingRule[],
  args: { docType?: string; vendor?: string; narration?: string; item?: string },
): PostingRule | null {
  const hayVendor = (args.vendor || "").toLowerCase();
  const hayNarration = args.narration || "";
  const hayItem = (args.item || "").toLowerCase();

  const scored = rules.filter((rule) => {
    if (rule.docType && args.docType && rule.docType !== args.docType) return false;
    if (rule.vendorPattern && !hayVendor.includes(rule.vendorPattern.toLowerCase())) return false;
    if (rule.itemPattern) {
      try {
        if (!new RegExp(rule.itemPattern, "i").test(hayItem)) return false;
      } catch {
        if (!hayItem.includes(rule.itemPattern.toLowerCase())) return false;
      }
    }
    if (rule.narrationRegex) {
      try {
        if (!new RegExp(rule.narrationRegex, "i").test(hayNarration)) return false;
      } catch {
        return false;
      }
    }
    return true;
  });

  scored.sort((a, b) => {
    const aClient = a.clientId ? 0 : 1;
    const bClient = b.clientId ? 0 : 1;
    if (aClient !== bClient) return aClient - bClient;
    return a.priority - b.priority;
  });
  return scored[0] || null;
}

export async function createPostingRule(
  userId: string,
  clientId: string,
  body: Partial<PostingRule> & { lineFlag: PostingRule["lineFlag"] },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const firmId = await firmIdForClient(db, clientId);
    const id = randomUUID();
    const row = await db.query(
      `INSERT INTO client_posting_rule (
         id, firm_id, client_id, doc_type, vendor_pattern, narration_regex, item_pattern,
         line_flag, vat_treatment, target_account_code, target_account_id,
         priority, defer_months, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       RETURNING id, firm_id AS "firmId", client_id AS "clientId", doc_type AS "docType",
                 vendor_pattern AS "vendorPattern", narration_regex AS "narrationRegex",
                 item_pattern AS "itemPattern", line_flag AS "lineFlag",
                 vat_treatment AS "vatTreatment", target_account_code AS "targetAccountCode",
                 target_account_id AS "targetAccountId", priority,
                 defer_months AS "deferMonths", active`,
      [
        id,
        firmId,
        body.clientId === null ? null : clientId,
        body.docType ?? null,
        body.vendorPattern ?? null,
        body.narrationRegex ?? null,
        body.itemPattern ?? null,
        body.lineFlag,
        body.vatTreatment || "standard",
        body.targetAccountCode ?? null,
        body.targetAccountId ?? null,
        body.priority ?? 100,
        body.deferMonths ?? 0,
      ],
    );
    return mapRule(row.rows[0]);
  });
}

export async function listFxRates(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT id, client_id AS "clientId", rate_date AS "rateDate", currency,
              rate_to_aed_scaled AS "rateToAedScaled"
       FROM fx_rate WHERE client_id = $1
       ORDER BY rate_date DESC, currency`,
      [clientId],
    );
    return rows.rows.map((row) => ({
      id: String(row.id),
      clientId: String(row.clientId),
      rateDate: String(row.rateDate),
      currency: String(row.currency),
      rateToAedScaled: Number(row.rateToAedScaled),
    })) as FxRate[];
  });
}

export async function upsertFxRate(
  userId: string,
  clientId: string,
  body: { rateDate: string; currency: string; rateToAedScaled: number },
) {
  if (!Number.isInteger(body.rateToAedScaled) || body.rateToAedScaled <= 0) {
    throw new LedgerError("invalid_fx_rate", "bad_request");
  }
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `INSERT INTO fx_rate (client_id, rate_date, currency, rate_to_aed_scaled)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id, rate_date, currency) DO UPDATE SET
         rate_to_aed_scaled = EXCLUDED.rate_to_aed_scaled
       RETURNING id, client_id AS "clientId", rate_date AS "rateDate", currency,
                 rate_to_aed_scaled AS "rateToAedScaled"`,
      [clientId, body.rateDate, body.currency.toUpperCase(), body.rateToAedScaled],
    );
    return {
      id: String(row.rows[0].id),
      clientId: String(row.rows[0].clientId),
      rateDate: String(row.rows[0].rateDate),
      currency: String(row.rows[0].currency),
      rateToAedScaled: Number(row.rows[0].rateToAedScaled),
    } as FxRate;
  });
}
