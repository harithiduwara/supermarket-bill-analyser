import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { openApp, rawBill } from "./helpers";

test.describe("US-06 backup and restore", () => {
  test("export downloads a valid file, and re-importing it changes nothing", async ({ page }) => {
    await openApp(page, "#/settings");
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export JSON backup/ }).click(),
    ]);
    const file = await dl.path();
    const json = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(json.version).toBe(1);
    expect(json.bills).toHaveLength(24);
    await expect(page.getByText("Last exported")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(file!);
    await expect(page.getByText(/0 added, 24 already present, 0 failed checks, 0 invalid/)).toBeVisible();
  });

  test("a hostile or malformed file is rejected with a reason and changes nothing", async ({ page }) => {
    await openApp(page, "#/settings");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{not json") });
    await expect(page.getByText(/Import failed: not valid JSON/)).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "y.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, bills: [{ ref: "../../x", items: [] }] })),
    });
    await expect(page.getByText(/Invalid bill #1/)).toBeVisible();
    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
  });

  test("import records activity, which is readable newest first", async ({ page }) => {
    await openApp(page, "#/settings");
    await page.locator('input[type="file"]').setInputFiles({
      name: "z.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, bills: [] })),
    });
    await expect(page.getByText("0 added", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("Import");
    await expect(page.getByText("24 of 24 seed bills loaded")).toBeVisible();
  });

  test("US-17 a saved e-bill is recorded in Activity", async ({ page }) => {
    // rejected/duplicate events cannot be produced through the UI (Save is disabled / no-ops); they are covered by tests/unit/audit.test.ts
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill("TEST02");
    await page.getByLabel(/Paste the page text/).fill(rawBill("YYLH0T"));
    await page.getByRole("button", { name: "Save to ledger" }).click();
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.getByText("✓ Added")).toBeVisible();
  });
});

test.describe("NFR-05 API key handling", () => {
  test("the key is not written to localStorage unless the user opts in, and can be removed", async ({
    page,
  }) => {
    await openApp(page, "#/settings");
    await page.getByLabel("API key").fill("sk-ant-secret");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem("anthropic_api_key"))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("anthropic_api_key"))).toBe("sk-ant-secret");

    await page.getByLabel(/Remember on this device/).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem("anthropic_api_key"))).toBe("sk-ant-secret");

    await page.getByRole("button", { name: "Remove key" }).click();
    expect(await page.evaluate(() => localStorage.getItem("anthropic_api_key"))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("anthropic_api_key"))).toBeNull();
  });

  test("the key field is masked by default", async ({ page }) => {
    await openApp(page, "#/settings");
    await expect(page.getByLabel("API key")).toHaveAttribute("type", "password");
  });
});
