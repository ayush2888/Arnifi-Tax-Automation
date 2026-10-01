import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { forwardUnlock } from "./unlock-proxy";

const SECRET = "synthetic-route-secret";

test("the unlock proxy forwards the password and does not log the body", async () => {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]])) as Record<
    (typeof methods)[number],
    (...args: unknown[]) => void
  >;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
  }
  let forwarded = "";
  try {
    const result = await forwardUnlock({
      statementId: "stmt-1",
      userId: "user-1",
      password: SECRET,
      fetchImpl: async (_url, init) => {
        forwarded = String(init?.body ?? "");
        return new Response(JSON.stringify({ status: "parsed" }), { status: 200 });
      },
    });
    assert.equal(result.status, 200);
    assert.equal(forwarded.includes(SECRET), true);
    assert.equal(lines.join("\n").includes(SECRET), false);
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
});

test("the web route and the worker access log do not print the unlock body", () => {
  const route = readFileSync(new URL("../app/api/[...path]/route.ts", import.meta.url), "utf8");
  const passwordBranch = route.slice(route.indexOf('path[2] === "password"'), route.indexOf('path[2] === "approve"'));
  assert.equal(passwordBranch.includes("console."), false);
  assert.match(passwordBranch, /forwardUnlock/);

  const proxy = readFileSync(new URL("./unlock-proxy.ts", import.meta.url), "utf8");
  assert.equal(proxy.includes("console."), false);

  const worker = readFileSync(new URL("../../worker/src/daftar/worker.py", import.meta.url), "utf8");
  const logFn = worker.slice(worker.indexOf("def log_message"), worker.indexOf("def poll"));
  assert.match(logFn, /args\[0\]/);
  assert.equal(logFn.includes("password"), false);
  assert.equal(logFn.includes("rfile"), false);
});
