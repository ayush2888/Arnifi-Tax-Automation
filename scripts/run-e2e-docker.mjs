#!/usr/bin/env node
/**
 * PowerShell-friendly entry: `npm run test:e2e:docker`
 * - Local (Docker Desktop): compose profile `e2e` (postgres + minio on compose network)
 * - CI: playwright image on host network against GHA postgres + moto
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const image = "mcr.microsoft.com/playwright:v1.63.0-jammy";
const mountRoot = root.replace(/\\/g, "/");

function run(command, args) {
  console.log(`+ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const envFlags = [
  "-e",
  "E2E_IN_CONTAINER=1",
  "-e",
  "PGPASSWORD=daftar-local-only",
  "-e",
  "PORTAL_SECURITY_STATUS=FAIL",
  "-e",
  "S3_ACCESS_KEY=daftar",
  "-e",
  "S3_SECRET_KEY=daftar-local-only",
  "-e",
  "S3_BUCKET=statements",
  "-e",
  "IBAN_ENCRYPTION_KEY=dev-only-iban-key-change-me",
];

if (process.env.CI === "true" || process.env.E2E_DOCKER_HOST_NET === "1") {
  run("docker", [
    "run",
    "--rm",
    "--network",
    "host",
    "-v",
    `${mountRoot}:/work`,
    "-v",
    "daftar_e2e_node_modules:/work/node_modules",
    "-v",
    "daftar_e2e_next:/work/.next",
    "-w",
    "/work",
    "-e",
    "PGHOST=127.0.0.1",
    "-e",
    "DATABASE_URL=postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_e2e",
    "-e",
    "DATABASE_URL_SUPER=postgresql://daftar:daftar-local-only@127.0.0.1:5432/daftar_e2e",
    "-e",
    "S3_ENDPOINT=http://127.0.0.1:59000",
    ...envFlags,
    image,
    "node",
    "scripts/e2e-docker-inner.mjs",
  ]);
} else {
  run("docker", ["compose", "--profile", "e2e", "run", "--rm", "e2e"]);
}
