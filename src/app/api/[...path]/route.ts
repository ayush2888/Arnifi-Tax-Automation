import { NextResponse } from "next/server";

import { MoneyTypeError } from "@/lib/money";
import { requireSession, SESSION_COOKIE } from "@/lib/session";
import { signedGetUrl } from "@/lib/storage";
import {
  actor,
  approveStatement,
  bankAccounts,
  bulkCategorize,
  categories,
  createRule,
  dashboard,
  deleteView,
  directory,
  disableRule,
  enqueueConfirm,
  exportTransactions,
  getStatement,
  getTransaction,
  listStatements,
  listTransactions,
  listViews,
  neighbors,
  registerUpload,
  rules,
  saveView,
  sourceFor,
  transactionMeta,
  type TxnQuery,
} from "@/server/data";
import { LedgerError } from "@/server/errors";
import {
  approveExtractionAndPost,
  createJournal,
  createPeriod,
  createSyntheticDocument,
  getExtraction,
  getJournal,
  listAccounts,
  listDocuments,
  listJournals,
  listPeriods,
  postJournal,
  trialBalance,
  vat201Draft,
} from "@/server/ledger";
import {
  approveVat201Pack,
  downloadVat201Pack,
  getReleasePack,
  listDownloadEvents,
  listReleasePacks,
  prepareVat201Pack,
} from "@/server/release";
import {
  autoProposeExactMatches,
  confirmMatch,
  controlCheck,
  createException,
  listExceptions,
  listOpenItems,
  listReconGroups,
  listUnmatchedBank,
  proposeMatch,
  resolveException,
} from "@/server/recon";
import {
  closeChecklist,
  closePeriod,
  createAccrual,
  listAccruals,
  listCloseEvents,
  listDepreciation,
  listFixedAssets,
  postAccrual,
  postDepreciation,
  registerFixedAsset,
  reopenPeriod,
  waiveAccrual,
  waiveReconForClose,
  waiveVatForClose,
} from "@/server/close";
import {
  approveStatementsPack,
  getFinancialStatements,
  prepareStatementsPack,
  yearEndCloseToRE,
} from "@/server/statements";
import { forwardUnlock } from "@/server/unlock-proxy";
import { patchTransaction } from "@/server/data";
import { createHash } from "node:crypto";

type Ctx = { params: Promise<{ path: string[] }> };

async function context() {
  const session = await requireSession();
  const who = await actor(session.userId, session.clientId);
  return { session, who };
}

function fail(error: unknown) {
  if (error instanceof MoneyTypeError) {
    return NextResponse.json({ error: "invalid_money" }, { status: 400 });
  }
  if (error instanceof LedgerError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "forbidden"
          ? 403
          : error.code === "conflict" || error.code === "period_closed"
            ? 409
            : 400;
    return NextResponse.json({ error: error.code, message: error.message }, { status });
  }
  const code = error instanceof Error ? error.name : "error";
  console.error("api", code);
  return NextResponse.json({ error: "request_failed" }, { status: 500 });
}

function queryOf(url: URL): TxnQuery {
  const minor = (key: string) => {
    const raw = url.searchParams.get(key);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value)) throw new MoneyTypeError("invalid_money");
    return value;
  };
  return {
    tab: url.searchParams.get("tab") || "all",
    q: url.searchParams.get("q") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    amountMinMinor: minor("amountMinMinor"),
    amountMaxMinor: minor("amountMaxMinor"),
    categoryId: url.searchParams.get("categoryId") || undefined,
    flag: url.searchParams.get("flag") || undefined,
    sort: url.searchParams.get("sort") || "date",
    dir: url.searchParams.get("dir") || "desc",
    offset: Number(url.searchParams.get("offset") || "0"),
    limit: Number(url.searchParams.get("limit") || "150"),
  };
}

export async function GET(request: Request, contextParams: Ctx) {
  try {
    const path = (await contextParams.params).path;
    const url = new URL(request.url);
    const { session, who } = await context();
    if (path[0] === "session") {
      const book = await directory(session.userId);
      return NextResponse.json({ ...book, clientId: session.clientId, signedIn: Boolean(who) });
    }
    if (!who) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (path[0] === "dashboard") return NextResponse.json(await dashboard(session.userId, session.clientId));
    if (path[0] === "bank-accounts") return NextResponse.json(await bankAccounts(session.userId, session.clientId));
    if (path[0] === "statements" && !path[1]) return NextResponse.json(await listStatements(session.userId, session.clientId));
    if (path[0] === "statements" && path[1]) {
      const statement = await getStatement(session.userId, session.clientId, path[1]);
      if (!statement) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(statement);
    }
    if (path[0] === "transactions" && path[1] === "meta") {
      return NextResponse.json(await transactionMeta(session.userId, session.clientId, queryOf(url)));
    }
    if (path[0] === "transactions" && path[1] === "export") {
      const csv = await exportTransactions(session.userId, session.clientId, queryOf(url));
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=transactions.csv",
        },
      });
    }
    if (path[0] === "transactions" && path[1] && path[2] === "source") {
      const source = await sourceFor(session.userId, session.clientId, path[1]);
      if (!source?.storage_key) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const signed = await signedGetUrl(source.storage_key);
      return NextResponse.json({
        url: signed,
        page: source.source_page,
        bbox: source.source_bbox,
        width: source.width,
        height: source.height,
      });
    }
    if (path[0] === "transactions" && path[1] && path[2] === "neighbors") {
      return NextResponse.json(await neighbors(session.userId, session.clientId, path[1], queryOf(url)));
    }
    if (path[0] === "transactions" && path[1]) {
      const txn = await getTransaction(session.userId, session.clientId, path[1]);
      if (!txn) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(txn);
    }
    if (path[0] === "transactions") {
      return NextResponse.json(await listTransactions(session.userId, session.clientId, queryOf(url)));
    }
    if (path[0] === "categories") return NextResponse.json(await categories(session.userId));
    if (path[0] === "rules") return NextResponse.json(await rules(session.userId, session.clientId));
    if (path[0] === "views") return NextResponse.json(await listViews(session.userId, session.clientId));
    if (path[0] === "periods" && !path[1]) return NextResponse.json(await listPeriods(session.userId, session.clientId));
    if (path[0] === "accounts") return NextResponse.json(await listAccounts(session.userId, session.clientId));
    if (path[0] === "journals" && path[1]) {
      const journal = await getJournal(session.userId, session.clientId, path[1]);
      if (!journal) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(journal);
    }
    if (path[0] === "journals") {
      return NextResponse.json(await listJournals(session.userId, session.clientId, url.searchParams.get("periodId") || undefined));
    }
    if (path[0] === "trial-balance") {
      const periodId = url.searchParams.get("periodId");
      if (!periodId) return NextResponse.json({ error: "periodId_required" }, { status: 400 });
      return NextResponse.json(await trialBalance(session.userId, session.clientId, periodId));
    }
    if (path[0] === "documents") {
      return NextResponse.json(await listDocuments(session.userId, session.clientId, url.searchParams.get("periodId") || undefined));
    }
    if (path[0] === "extractions" && path[1]) {
      const extraction = await getExtraction(session.userId, session.clientId, path[1]);
      if (!extraction) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(extraction);
    }
    if (path[0] === "periods" && path[1] && path[2] === "vat201-draft") {
      return NextResponse.json(await vat201Draft(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "release-packs" && path[1] && path[2] === "downloads") {
      return NextResponse.json(await listDownloadEvents(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "release-packs" && path[1]) {
      const pack = await getReleasePack(session.userId, session.clientId, path[1]);
      if (!pack) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(pack);
    }
    if (path[0] === "release-packs") {
      return NextResponse.json(
        await listReleasePacks(session.userId, session.clientId, url.searchParams.get("periodId") || undefined),
      );
    }
    if (path[0] === "downloads") {
      return NextResponse.json(
        await listDownloadEvents(session.userId, session.clientId, url.searchParams.get("packId") || undefined),
      );
    }
    if (path[0] === "open-items") {
      return NextResponse.json(
        await listOpenItems(session.userId, session.clientId, {
          side: (url.searchParams.get("side") as "AR" | "AP" | null) || undefined,
          status: url.searchParams.get("status") || undefined,
          periodId: url.searchParams.get("periodId") || undefined,
        }),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "control-check") {
      return NextResponse.json(await controlCheck(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "recon-groups") {
      return NextResponse.json(await listReconGroups(session.userId, session.clientId));
    }
    if (path[0] === "recon-bank") {
      return NextResponse.json(await listUnmatchedBank(session.userId, session.clientId));
    }
    if (path[0] === "recon-exceptions") {
      return NextResponse.json(
        await listExceptions(session.userId, session.clientId, url.searchParams.get("status") || "OPEN"),
      );
    }
    if (path[0] === "accruals") {
      return NextResponse.json(
        await listAccruals(session.userId, session.clientId, url.searchParams.get("periodId") || undefined),
      );
    }
    if (path[0] === "fixed-assets") {
      return NextResponse.json(await listFixedAssets(session.userId, session.clientId));
    }
    if (path[0] === "depreciation") {
      return NextResponse.json(
        await listDepreciation(session.userId, session.clientId, url.searchParams.get("periodId") || undefined),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "close-checklist") {
      return NextResponse.json(await closeChecklist(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "periods" && path[1] && path[2] === "close-events") {
      return NextResponse.json(await listCloseEvents(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "periods" && path[1] && path[2] === "financials") {
      return NextResponse.json(await getFinancialStatements(session.userId, session.clientId, path[1]));
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, contextParams: Ctx) {
  try {
    const path = (await contextParams.params).path;
    const { session, who } = await context();
    if (path[0] === "session") {
      const body = await request.json();
      const userId = String(body.userId || "");
      let clientId = String(body.clientId || "");
      let allowed = clientId ? await actor(userId, clientId) : null;
      if (!allowed) {
        const book = await directory(userId);
        clientId = book.clients[0]?.id || "";
        allowed = clientId ? await actor(userId, clientId) : null;
      }
      if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const response = NextResponse.json({ ok: true });
      response.cookies.set("daftar_user", userId, SESSION_COOKIE);
      response.cookies.set("daftar_client", clientId, SESSION_COOKIE);
      return response;
    }
    if (!who) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (path[0] === "uploads") {
      const form = await request.formData();
      const file = form.get("file");
      const bankAccountId = String(form.get("bankAccountId") || "");
      if (!(file instanceof File)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "too_large" }, { status: 400 });
      const content = Buffer.from(await file.arrayBuffer());
      const result = await registerUpload(session.userId, session.clientId, bankAccountId, file.name, content, file.type);
      if ("error" in result) return NextResponse.json(result, { status: result.error === "forbidden" ? 403 : 400 });
      return NextResponse.json(result);
    }
    if (path[0] === "statements" && path[2] === "mapping") {
      const body = await request.json();
      const result = await enqueueConfirm(session.userId, session.clientId, path[1], body);
      if ("error" in result) return NextResponse.json(result, { status: result.error === "forbidden" ? 403 : 404 });
      return NextResponse.json(result);
    }
    if (path[0] === "statements" && path[2] === "password") {
      const body = await request.json();
      const password = String(body.password || "");
      if (!password) return NextResponse.json({ error: "password_required" }, { status: 400 });
      // The body is forwarded and then dropped. It is not written to the log.
      const forwarded = await forwardUnlock({
        statementId: path[1],
        userId: session.userId,
        password,
      });
      return NextResponse.json(forwarded.payload, { status: forwarded.status });
    }
    if (path[0] === "statements" && path[2] === "approve") {
      const result = await approveStatement(session.userId, session.clientId, path[1]);
      return NextResponse.json(result);
    }
    if (path[0] === "transactions" && path[1] === "bulk-category") {
      const body = await request.json();
      const result = await bulkCategorize(
        session.userId,
        session.clientId,
        String(body.categoryId),
        Array.isArray(body.ids) ? body.ids : null,
        body.allMatching ? queryOf(new URL(request.url)) : null,
      );
      if ("error" in result) return NextResponse.json(result, { status: 403 });
      return NextResponse.json(result);
    }
    if (path[0] === "rules" && path[2] === "disable") {
      const result = await disableRule(session.userId, session.clientId, path[1]);
      if ("error" in result) return NextResponse.json(result, { status: 403 });
      return NextResponse.json(result);
    }
    if (path[0] === "rules") {
      const body = await request.json();
      const result = await createRule(session.userId, session.clientId, body);
      if ("error" in result) return NextResponse.json(result, { status: result.error === "forbidden" ? 403 : 400 });
      return NextResponse.json(result);
    }
    if (path[0] === "views") {
      const body = await request.json();
      return NextResponse.json(await saveView(session.userId, session.clientId, String(body.name || "View"), body.config));
    }
    if (path[0] === "periods" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await createPeriod(session.userId, session.clientId, {
          label: String(body.label || ""),
          periodStart: String(body.periodStart || ""),
          periodEnd: String(body.periodEnd || ""),
        }),
      );
    }
    if (path[0] === "journals" && path[1] && path[2] === "post") {
      return NextResponse.json(await postJournal(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "journals" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await createJournal(session.userId, session.clientId, {
          periodId: String(body.periodId || ""),
          memo: body.memo ? String(body.memo) : "",
          entryDate: String(body.entryDate || ""),
          lines: Array.isArray(body.lines) ? body.lines : [],
          sourceFileId: body.sourceFileId || null,
          sourceDocumentId: body.sourceDocumentId || null,
          sourceExtractionId: body.sourceExtractionId || null,
          post: Boolean(body.post),
        }),
      );
    }
    if (path[0] === "documents" && path[1] === "synthetic") {
      const body = await request.json();
      return NextResponse.json(
        await createSyntheticDocument(session.userId, session.clientId, {
          periodId: String(body.periodId || ""),
          docType: body.docType,
          originalName: String(body.originalName || "synthetic.json"),
          facts: body.facts && typeof body.facts === "object" ? body.facts : {},
        }),
      );
    }
    if (path[0] === "extractions" && path[1] && path[2] === "approve-post") {
      return NextResponse.json(await approveExtractionAndPost(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "periods" && path[1] && path[2] === "vat201-prepare") {
      return NextResponse.json(await prepareVat201Pack(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "release-packs" && path[1] && path[2] === "approve") {
      return NextResponse.json(await approveVat201Pack(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "release-packs" && path[1] && path[2] === "download") {
      const forwarded = request.headers.get("x-forwarded-for") || "";
      const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
      const ipHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null;
      const bundle = await downloadVat201Pack(session.userId, session.clientId, path[1], {
        ipHash,
        userAgent: request.headers.get("user-agent"),
      });
      return new NextResponse(JSON.stringify(bundle, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="vat201-v${bundle.version}-${bundle.packId.slice(0, 8)}.json"`,
        },
      });
    }
    if (path[0] === "recon-matches" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await proposeMatch(session.userId, session.clientId, {
          periodId: body.periodId || null,
          bankTransactionIds: Array.isArray(body.bankTransactionIds) ? body.bankTransactionIds : [],
          openItemIds: Array.isArray(body.openItemIds) ? body.openItemIds : [],
          note: body.note ? String(body.note) : "",
        }),
      );
    }
    if (path[0] === "recon-matches" && path[1] && path[2] === "confirm") {
      return NextResponse.json(await confirmMatch(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "periods" && path[1] && path[2] === "recon-auto") {
      return NextResponse.json(await autoProposeExactMatches(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "recon-exceptions" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await createException(session.userId, session.clientId, {
          kind: body.kind,
          message: String(body.message || ""),
          periodId: body.periodId || null,
          bankTransactionId: body.bankTransactionId || null,
          openItemId: body.openItemId || null,
        }),
      );
    }
    if (path[0] === "recon-exceptions" && path[1] && path[2] === "resolve") {
      return NextResponse.json(await resolveException(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "accruals" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await createAccrual(session.userId, session.clientId, {
          periodId: String(body.periodId || ""),
          kind: body.kind === "PREPAYMENT" ? "PREPAYMENT" : "ACCRUAL",
          memo: String(body.memo || ""),
          debitAccountId: String(body.debitAccountId || ""),
          creditAccountId: String(body.creditAccountId || ""),
          amountMinor: Number(body.amountMinor || 0),
          autoReverse: body.autoReverse !== false,
        }),
      );
    }
    if (path[0] === "accruals" && path[1] && path[2] === "post") {
      return NextResponse.json(await postAccrual(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "accruals" && path[1] && path[2] === "waive") {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json(
        await waiveAccrual(session.userId, session.clientId, path[1], String(body.reason || "")),
      );
    }
    if (path[0] === "fixed-assets" && !path[1]) {
      const body = await request.json();
      return NextResponse.json(
        await registerFixedAsset(session.userId, session.clientId, {
          code: String(body.code || ""),
          name: String(body.name || ""),
          costMinor: Number(body.costMinor || 0),
          residualMinor: Number(body.residualMinor || 0),
          lifeMonths: Number(body.lifeMonths || 0),
          inServiceOn: String(body.inServiceOn || ""),
          assetAccountId: String(body.assetAccountId || ""),
          accumDeprAccountId: String(body.accumDeprAccountId || ""),
          deprExpenseAccountId: String(body.deprExpenseAccountId || ""),
          periodId: String(body.periodId || ""),
        }),
      );
    }
    if (path[0] === "depreciation" && path[1] && path[2] === "post") {
      return NextResponse.json(await postDepreciation(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "periods" && path[1] && path[2] === "close") {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json(
        await closePeriod(session.userId, session.clientId, path[1], String(body.reason || "")),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "reopen") {
      const body = await request.json();
      return NextResponse.json(
        await reopenPeriod(session.userId, session.clientId, path[1], {
          reason: String(body.reason || ""),
          ticketRef: body.ticketRef ? String(body.ticketRef) : "",
        }),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "waive-vat") {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json(
        await waiveVatForClose(session.userId, session.clientId, path[1], String(body.reason || "")),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "waive-recon") {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json(
        await waiveReconForClose(session.userId, session.clientId, path[1], String(body.reason || "")),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "year-end-close") {
      const body = await request.json().catch(() => ({}));
      return NextResponse.json(
        await yearEndCloseToRE(session.userId, session.clientId, path[1], String(body.note || "")),
      );
    }
    if (path[0] === "periods" && path[1] && path[2] === "statements-prepare") {
      return NextResponse.json(await prepareStatementsPack(session.userId, session.clientId, path[1]));
    }
    if (path[0] === "release-packs" && path[1] && path[2] === "approve-statements") {
      return NextResponse.json(await approveStatementsPack(session.userId, session.clientId, path[1]));
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, contextParams: Ctx) {
  try {
    const path = (await contextParams.params).path;
    const { session, who } = await context();
    if (!who) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (path[0] === "transactions" && path[1]) {
      const body = await request.json();
      const result = await patchTransaction(session.userId, session.clientId, path[1], body);
      if ("error" in result) return NextResponse.json(result, { status: result.error === "forbidden" ? 403 : 404 });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, contextParams: Ctx) {
  try {
    const path = (await contextParams.params).path;
    const { session, who } = await context();
    if (!who) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (path[0] === "views" && path[1]) {
      return NextResponse.json(await deleteView(session.userId, session.clientId, path[1]));
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}
