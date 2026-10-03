import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT || 43127);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    // Docker e2e builds standalone first and sets E2E_WEB_COMMAND=node .next/standalone/server.js
    command: process.env.E2E_WEB_COMMAND || `node .next/standalone/server.js`,
    // `/` redirects until a session cookie exists; probe a static asset instead.
    url: `http://127.0.0.1:${PORT}/icon.svg`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_e2e",
      HOSTNAME: "127.0.0.1",
      PORT: String(PORT),
      PORTAL_SECURITY_STATUS: process.env.PORTAL_SECURITY_STATUS || "FAIL",
      NODE_ENV: "production",
    },
  },
});
