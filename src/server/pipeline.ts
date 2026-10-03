import { withUser } from "@/lib/db";
import { trialBalance } from "@/server/ledger";
import { controlCheck, listUnmatchedBank } from "@/server/recon";
import { assertSyntheticTenant } from "@/server/security-gate";
import { evaluateIntegrity, getFinancialStatements } from "@/server/statements";
import { markVatPacksStale } from "@/server/release";

export const PIPELINE_STAGES = [
  "DOCS_COLLECTING",
  "EXTRACTED",
  "JOURNALS_PROPOSED",
  "JOURNALS_POSTED",
  "RECONCILED",
  "CLOSE_CHECKS",
  "TB_BALANCED",
  "STATEMENTS_READY",
  "PACKS_RELEASED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineBlocker = {
  code: string;
  message: string;
  severity: "block" | "warn";
};

export type PipelineStatus = {
  clientId: string;
  periodId: string;
  stage: PipelineStage;
  counts: Record<string, number>;
  blockers: PipelineBlocker[];
  provisionalOpening: boolean;
  assigneeUserId: string | null;
  lastRunAt: string | null;
};

const SUSPENSE_CODE = "1190";
const GATEWAY_CLEAR_CODE = "1310";

export async function getPipelineStatus(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `SELECT client_id AS "clientId", period_id AS "periodId", stage,
              counts_json AS counts, blockers_json AS blockers,
              provisional_opening AS "provisionalOpening",
              assignee_user_id AS "assigneeUserId", last_run_at AS "lastRunAt"
       FROM period_pipeline_status
       WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
    if (!row.rowCount) {
      return {
        clientId,
        periodId,
        stage: "DOCS_COLLECTING" as PipelineStage,
        counts: {},
        blockers: [],
        provisionalOpening: false,
        assigneeUserId: null,
        lastRunAt: null,
      };
    }
    const r = row.rows[0];
    return {
      clientId: String(r.clientId),
      periodId: String(r.periodId),
      stage: r.stage as PipelineStage,
      counts: (r.counts as Record<string, number>) || {},
      blockers: (r.blockers as PipelineBlocker[]) || [],
      provisionalOpening: Boolean(r.provisionalOpening),
      assigneeUserId: (r.assigneeUserId as string | null) ?? null,
      lastRunAt: r.lastRunAt ? String(r.lastRunAt) : null,
    };
  });
}

export async function listFirmPipeline(
  userId: string,
  opts?: { periodLabel?: string },
): Promise<
  Array<{
    clientId: string;
    clientName: string;
    periodId: string | null;
    periodLabel: string | null;
    status: PipelineStatus;
  }>
> {
  const catalog = await withUser(userId, async (db) => {
    const clients = await db.query(
      `SELECT c.id, c.name
       FROM clients c
       WHERE c.id IN (SELECT visible_client_ids())
       ORDER BY c.name`,
    );
    const rows: Array<{ clientId: string; clientName: string; periodId: string | null; periodLabel: string | null }> =
      [];
    for (const client of clients.rows) {
      const clientId = String(client.id);
      const periods = await db.query(
        `SELECT id, label FROM accounting_periods
         WHERE client_id = $1
         ORDER BY period_start DESC
         LIMIT 8`,
        [clientId],
      );
      let period = periods.rows[0] || null;
      if (opts?.periodLabel) {
        period = periods.rows.find((p) => String(p.label) === opts.periodLabel) || period;
      }
      rows.push({
        clientId,
        clientName: String(client.name),
        periodId: period ? String(period.id) : null,
        periodLabel: period ? String(period.label) : null,
      });
    }
    return rows;
  });

  const out: Array<{
    clientId: string;
    clientName: string;
    periodId: string | null;
    periodLabel: string | null;
    status: PipelineStatus;
  }> = [];
  for (const row of catalog) {
    if (!row.periodId) {
      out.push({
        ...row,
        status: {
          clientId: row.clientId,
          periodId: "",
          stage: "DOCS_COLLECTING",
          counts: {},
          blockers: [{ code: "no_period", message: "No accounting period", severity: "block" }],
          provisionalOpening: false,
          assigneeUserId: null,
          lastRunAt: null,
        },
      });
      continue;
    }
    out.push({
      ...row,
      status: await getPipelineStatus(userId, row.clientId, row.periodId),
    });
  }
  return out;
}

export async function missingDocsChecklist(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await db.query(
      `SELECT period_start AS "start", period_end AS "end", label FROM accounting_periods
       WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) return [];

    const sources = await db.query(
      `SELECT id, kind, label FROM client_source_account WHERE client_id = $1 AND active`,
      [clientId],
    );
    const docs = await db.query(
      `SELECT doc_type, source_account_id, original_name
       FROM documents WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
    const docTypes = new Set(docs.rows.map((d) => String(d.doc_type)));
    const coveredSources = new Set(
      docs.rows.map((d) => d.source_account_id).filter(Boolean).map(String),
    );

    const items: Array<{ code: string; ok: boolean; message: string; requestTemplate?: string }> = [];
    for (const source of sources.rows) {
      const ok =
        coveredSources.has(String(source.id)) ||
        (source.kind === "bank" && docTypes.has("BANK_STATEMENT")) ||
        (source.kind === "card" && docTypes.has("CARD_STATEMENT")) ||
        (source.kind === "gateway" && (docTypes.has("GATEWAY_CSV") || docTypes.has("GATEWAY_PDF")));
      items.push({
        code: `source_${source.id}`,
        ok,
        message: ok
          ? `Statement present for ${source.label}`
          : `Missing ${source.kind} statement for ${source.label}`,
        requestTemplate: ok
          ? undefined
          : `Please send the ${source.kind} statement for ${source.label} covering ${period.rows[0].label}.`,
      });
    }
    items.push({
      code: "opening_tb",
      ok: docTypes.has("OPENING_TB") || docTypes.has("PRIOR_FS"),
      message: docTypes.has("OPENING_TB") || docTypes.has("PRIOR_FS")
        ? "Opening TB / prior FS present"
        : "Missing opening trial balance",
      requestTemplate: "Please send the opening trial balance (CSV) or prior-year balance sheet.",
    });

    const unmatchedNarr = await db.query(
      `SELECT description_clean FROM bank_transactions bt
       JOIN statements s ON s.id = bt.statement_id
       WHERE bt.client_id = $1
         AND bt.txn_date BETWEEN $2 AND $3
       LIMIT 50`,
      [clientId, period.rows[0].start, period.rows[0].end],
    );
    const salaryLike = unmatchedNarr.rows.some((r) =>
      /salary|wps|payroll/i.test(String(r.description_clean || "")),
    );
    if (salaryLike) {
      items.push({
        code: "payroll",
        ok: false,
        message: "Salary-like narrations found — payroll support needed",
        requestTemplate: "Please send payroll / WPS file for this period.",
      });
    }
    return items;
  });
}

export async function recomputePipeline(userId: string, clientId: string, periodId: string) {
  const blockers: PipelineBlocker[] = [];
  const counts: Record<string, number> = {};

  const docs = await withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    return db.query(
      `SELECT status, extraction_confidence, doc_type FROM documents
       WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
  });
  counts.docs = docs.rowCount || 0;
  counts.extracted = docs.rows.filter((d) =>
    ["extracted", "needs_review", "approved", "posted"].includes(String(d.status)),
  ).length;

  const proposals = await withUser(userId, async (db) =>
    db.query(
      `SELECT status, confidence FROM journal_proposals
       WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    ),
  );
  counts.proposed = proposals.rows.filter((p) => p.status === "PROPOSED").length;
  counts.postedProposals = proposals.rows.filter((p) => p.status === "POSTED").length;
  const lowConf = proposals.rows.filter((p) => p.status === "PROPOSED" && Number(p.confidence) < 50).length;
  counts.lowConfidence = lowConf;
  if (lowConf > 0) {
    blockers.push({
      code: "low_confidence",
      message: `${lowConf} low-confidence proposal(s) need review`,
      severity: "block",
    });
  }

  const unmatched = await listUnmatchedBank(userId, clientId, 500);
  counts.unmatched = unmatched.length;

  const tb = await trialBalance(userId, clientId, periodId);
  const tbBalanced = Boolean(tb.balanced);
  const suspenseBal = await withUser(userId, async (db) =>
    db.query(
      `SELECT COALESCE(SUM(l.debit_minor) - SUM(l.credit_minor), 0)::bigint AS bal
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted' AND a.code = $3`,
      [clientId, periodId, SUSPENSE_CODE],
    ),
  );
  counts.suspense = Math.abs(Number(suspenseBal.rows[0]?.bal || 0));
  if (counts.suspense !== 0) {
    blockers.push({
      code: "suspense",
      message: `Suspense balance ${counts.suspense} minor units`,
      severity: "block",
    });
  }

  const clearing = await withUser(userId, async (db) =>
    db.query(
      `SELECT COALESCE(SUM(l.debit_minor) - SUM(l.credit_minor), 0)::bigint AS bal
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_accounts a ON a.id = l.account_id
       WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted' AND a.code = $3`,
      [clientId, periodId, GATEWAY_CLEAR_CODE],
    ),
  );
  counts.clearing = Math.abs(Number(clearing.rows[0]?.bal || 0));
  if (counts.clearing !== 0) {
    blockers.push({
      code: "gateway_clearing",
      message: "Gateway clearing does not net to zero",
      severity: "block",
    });
  }

  if (!tbBalanced) {
    blockers.push({ code: "tb", message: "Trial balance does not balance", severity: "block" });
  }

  let controlOk = true;
  try {
    const control = await controlCheck(userId, clientId, periodId);
    controlOk = Boolean(control.ar?.balanced && control.ap?.balanced);
  } catch {
    controlOk = true; // period without open items
  }
  if (!controlOk) {
    blockers.push({ code: "control", message: "AR/AP control check failed", severity: "block" });
  }

  const missing = await missingDocsChecklist(userId, clientId, periodId);
  for (const item of missing.filter((m) => !m.ok)) {
    blockers.push({ code: item.code, message: item.message, severity: item.code === "opening_tb" ? "block" : "warn" });
  }

  const statusRow = await withUser(userId, async (db) =>
    db.query(
      `SELECT provisional_opening AS "provisionalOpening" FROM period_pipeline_status
       WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    ),
  );
  const provisional = Boolean(statusRow.rows[0]?.provisionalOpening);
  const openingMissing = missing.some((m) => m.code === "opening_tb" && !m.ok);
  if (openingMissing && !provisional) {
    // already added as block
  } else if (openingMissing && provisional) {
    blockers.push({
      code: "provisional_opening",
      message: "Using provisional opening from bank — warning",
      severity: "warn",
    });
  }

  let statementsReady = false;
  try {
    const fs = await getFinancialStatements(userId, clientId, periodId);
    const integrity =
      fs.integrity ||
      evaluateIntegrity({
        totalDebit: Number(tb.totalDebit),
        totalCredit: Number(tb.totalCredit),
        totalAssets: Number(fs.balanceSheet.totalAssetsMinor),
        totalLiabilities: Number(fs.balanceSheet.totalLiabilitiesMinor),
        totalEquity: Number(fs.balanceSheet.totalEquityMinor),
        openingRe: Number(fs.retainedEarnings.openingMinor),
        netIncome: Number(fs.pnl.netIncomeMinor),
        dividends: Number(fs.retainedEarnings.dividendsMinor),
        closingRe: Number(fs.retainedEarnings.closingMinor),
      });
    statementsReady = Boolean(integrity.ready);
    if (!integrity.ready) {
      blockers.push({ code: "integrity", message: "Statement integrity gates failed", severity: "block" });
    }
  } catch {
    statementsReady = false;
  }

  const packs = await withUser(userId, async (db) =>
    db.query(
      `SELECT status FROM release_packs
       WHERE client_id = $1 AND period_id = $2 AND status = 'RELEASED'`,
      [clientId, periodId],
    ),
  );

  let stage: PipelineStage = "DOCS_COLLECTING";
  if (counts.docs > 0) stage = "DOCS_COLLECTING";
  if (counts.extracted > 0) stage = "EXTRACTED";
  if (counts.proposed > 0 || counts.postedProposals > 0) stage = "JOURNALS_PROPOSED";
  if (counts.postedProposals > 0 && counts.proposed === 0) stage = "JOURNALS_POSTED";
  if (stage === "JOURNALS_POSTED" && counts.unmatched === 0 && controlOk) stage = "RECONCILED";
  if (stage === "RECONCILED") stage = "CLOSE_CHECKS";
  if (tbBalanced && stage === "CLOSE_CHECKS") stage = "TB_BALANCED";
  if (
    stage === "TB_BALANCED" &&
    statementsReady &&
    counts.suspense === 0 &&
    counts.clearing === 0 &&
    lowConf === 0
  ) {
    stage = "STATEMENTS_READY";
  }
  if ((packs.rowCount || 0) > 0 && stage === "STATEMENTS_READY") stage = "PACKS_RELEASED";

  // Hard blocks prevent advancing past JOURNALS_POSTED
  const hard = blockers.filter((b) => b.severity === "block");
  if (hard.length && PIPELINE_STAGES.indexOf(stage) > PIPELINE_STAGES.indexOf("JOURNALS_POSTED")) {
    if (!tbBalanced) stage = "JOURNALS_POSTED";
    else if (counts.suspense || counts.clearing || lowConf) stage = "CLOSE_CHECKS";
  }

  await withUser(userId, async (db) => {
    await db.query(
      `INSERT INTO period_pipeline_status (
         client_id, period_id, stage, counts_json, blockers_json, last_run_at, updated_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb, now(), now())
       ON CONFLICT (client_id, period_id) DO UPDATE SET
         stage = EXCLUDED.stage,
         counts_json = EXCLUDED.counts_json,
         blockers_json = EXCLUDED.blockers_json,
         last_run_at = now(),
         updated_at = now()`,
      [clientId, periodId, stage, JSON.stringify(counts), JSON.stringify(blockers)],
    );
  });

  return getPipelineStatus(userId, clientId, periodId);
}

export async function setProvisionalOpening(
  userId: string,
  clientId: string,
  periodId: string,
  value: boolean,
  actorRole: string,
) {
  if (value && actorRole !== "admin") {
    const { LedgerError } = await import("./errors");
    throw new LedgerError("admin_required", "forbidden");
  }
  await withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    await db.query(
      `INSERT INTO period_pipeline_status (client_id, period_id, provisional_opening, stage)
       VALUES ($1,$2,$3,'DOCS_COLLECTING')
       ON CONFLICT (client_id, period_id) DO UPDATE SET provisional_opening = $3, updated_at = now()`,
      [clientId, periodId, value],
    );
  });
  return recomputePipeline(userId, clientId, periodId);
}

export async function rewindPipelineOnMutation(userId: string, clientId: string, periodId: string) {
  await withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    await markVatPacksStale(db, clientId, periodId);
    await db.query(
      `UPDATE period_pipeline_status
       SET stage = 'JOURNALS_PROPOSED', updated_at = now()
       WHERE client_id = $1 AND period_id = $2
         AND stage IN ('JOURNALS_POSTED','RECONCILED','CLOSE_CHECKS','TB_BALANCED','STATEMENTS_READY','PACKS_RELEASED')`,
      [clientId, periodId],
    );
  });
  return recomputePipeline(userId, clientId, periodId);
}
