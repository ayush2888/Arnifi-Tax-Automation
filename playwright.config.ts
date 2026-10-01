import { defineConfig } from "@playwright/test";

const PORT = 43127;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next dev --turbopack -H 127.0.0.1 -p ${PORT}`,
    // `/` redirects until a session cookie exists, and the probe follows that forever.
    url: `http://127.0.0.1:${PORT}/icon.svg`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_e2e",
      HOSTNAME: "127.0.0.1",
    },
  },
});
