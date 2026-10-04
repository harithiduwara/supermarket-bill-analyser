import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.describe("NFR-04 content security policy", () => {
  test("the production page ships a strict CSP and no-referrer policy", async ({ page }) => {
    // the build HTML-escapes quotes inside the attribute (&#39;); browsers decode them, so do the same here
    const html = (await (await page.request.get("/")).text()).replaceAll("&#39;", "'");
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toMatch(/script-src 'self'/);
    expect(html).toMatch(/connect-src 'self' https:\/\/api\.anthropic\.com/);
    expect(html).toMatch(/object-src 'none'/);
    expect(html).toMatch(/name="referrer" content="no-referrer"/);
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>[^<]/); // no inline scripts
  });

  test("every screen runs without a single CSP violation or console error", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    for (const h of ["#/", "#/bill/FYQQRQ", "#/add/ebill", "#/add/receipt", "#/activity", "#/settings"]) {
      await openApp(page, h);
    }
    await page.getByRole("link", { name: "Add receipt" }).click();
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    expect(problems).toEqual([]);
  });

  test("NFR-06 no third-party network requests are made while using the app", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", ""].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
    });
    for (const h of ["#/", "#/bill/FYQQRQ", "#/add/receipt", "#/settings"]) await openApp(page, h);
    expect(external).toEqual([]);
  });

  test("the built bundle contains no API key or secret-looking strings", async () => {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/assets");
    for (const f of fs.readdirSync(dist).filter((n) => n.endsWith(".js"))) {
      expect(fs.readFileSync(path.join(dist, f), "utf8")).not.toMatch(/sk-ant-[A-Za-z0-9_-]{10,}/);
    }
  });
});
