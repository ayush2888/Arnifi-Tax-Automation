import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  {
    name: "daftar_user",
    value: "55555555-5555-4555-8555-555555555555",
    domain: "web",
    path: "/",
  },
  {
    name: "daftar_client",
    value: "e1000001-0000-4000-8000-000000000001",
    domain: "web",
    path: "/",
  },
]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message, e.stack?.split("\n").slice(0, 5).join("\n")));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.goto("http://web:43123/books/journals", { waitUntil: "networkidle", timeout: 60_000 });
console.log("URL", page.url());
console.log("BODY", (await page.locator("body").innerText()).slice(0, 800));
await browser.close();
