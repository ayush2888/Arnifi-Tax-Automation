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
import { forwardUnlock } from "@/server/unlock-proxy";
import { patchTransaction } from "@/server/data";

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
