import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const ARTIFACTS = path.resolve(__dirname, "artifacts");

test("scrolls 50,000 rows and screenshots the source highlight", async ({ page }) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.goto("/transactions");
  await expect(page.getByRole("button", { name: "All 50000" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "V50000", exact: true })).toBeVisible();

  const scroller = page.getByTestId("txn-scroll");
  const started = Date.now();
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("button", { name: "V00001", exact: true })).toBeVisible({ timeout: 20_000 });
  const elapsedMs = Date.now() - started;
  const mounted = await page.locator("[data-row]").count();
  const totalSize = Number(await scroller.getAttribute("data-total-size"));
  writeFileSync(
    path.join(ARTIFACTS, "scroll-timing.json"),
    JSON.stringify({ rows: 50000, elapsedMs, mountedRows: mounted, totalSizePx: totalSize }, null, 2),
  );
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(80);
  expect(totalSize).toBe(50000 * 36);

  await page.getByPlaceholder("Search description or reference").fill("KNOWN-SOURCE");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "KNOWN-SOURCE", exact: true }).click();
  await page.getByRole("tab", { name: "Source" }).click();
  const highlight = page.getByTestId("source-highlight");
  await expect(highlight).toBeVisible();
  await expect
    .poll(async () => page.getByAltText("Statement page with the selected row").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByTestId("source-page").screenshot({ path: path.join(ARTIFACTS, "source-highlight.png") });
  const box = await highlight.boundingBox();
  expect(box && box.width).toBeGreaterThan(20);
  expect(box && box.height).toBeGreaterThan(4);
});
