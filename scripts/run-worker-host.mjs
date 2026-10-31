/**
 * Run the Python worker on the host.
 * OCR comes from .env (OCR_PROVIDER=textract|local). Expects worker/.venv + Docker infra.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "worker");
const isWin = process.platform === "win32";
const python = isWin
  ? path.join(workerDir, ".venv", "Scripts", "python.exe")
  : path.join(workerDir, ".venv", "bin", "python");

if (!fs.existsSync(python)) {
  console.error(`Missing ${python}`);
  console.error("Create it once:");
  console.error(isWin ? "  cd worker && py -3.12 -m venv .venv && .\\.venv\\Scripts\\pip install -e ." : "  cd worker && python3 -m venv .venv && .venv/bin/pip install -e .");
  process.exit(1);
}

const env = { ...process.env };
const rootEnvPath = path.join(root, ".env");
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}
if (!env.TESSERACT_CMD && isWin) {
  const guess = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
  if (fs.existsSync(guess)) env.TESSERACT_CMD = guess;
}
env.OCR_PROVIDER = env.OCR_PROVIDER || "textract";

const child = spawn(python, ["-m", "daftar.worker"], {
  cwd: workerDir,
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 1));
