#!/usr/bin/env node
/**
 * Runs inside the Playwright Linux image. Assumes /work is the repo mount and
 * node_modules / .next are Linux volumes (not Windows host installs).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

function run(cmd, args, opts = {}) {
  console.log(`+ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.E2E_IN_CONTAINER !== "1" && !existsSync("/.dockerenv")) {
  console.error("e2e-docker-inner.mjs must run inside the Playwright container (E2E_IN_CONTAINER=1)");
  process.exit(2);
}

run("apt-get", ["update", "-qq"]);
run("apt-get", ["install", "-y", "-qq", "postgresql-client"], {
  env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
});

// Fresh Linux install into the shadowed volume — never reuse host win32 binaries.
run("npm", ["ci"]);

// Webpack production build (not turbopack). output: standalone → node server.js for e2e.
run("npx", ["next", "build"]);

const standalone = path.join(process.cwd(), ".next", "standalone");
mkdirSync(path.join(standalone, ".next"), { recursive: true });
cpSync(path.join(process.cwd(), ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(process.cwd(), "public"))) {
  cpSync(path.join(process.cwd(), "public"), path.join(standalone, "public"), { recursive: true });
}

process.env.PORT = process.env.PORT || "43127";
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
process.env.E2E_IN_CONTAINER = "1";
process.env.E2E_WEB_COMMAND =
  process.env.E2E_WEB_COMMAND || `node .next/standalone/server.js`;

const pwArgs = ["playwright", "test"];
if (process.env.E2E_UPDATE_SNAPSHOTS === "1") pwArgs.push("--update-snapshots");
run("npx", pwArgs);
