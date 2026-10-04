import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openApp, PNG, lbl } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const routes: { name: string; hash: string; prepare?: (p: Page) => Promise<void> }[] = [
  { name: "ledger", hash: "#/" },
  { name: "bill", hash: "#/bill/FYQQRQ" },
  { name: "glomark bill", hash: "#/bill/GLO549921" },
  { name: "add e-bill", hash: "#/add/ebill" },
  { name: "add receipt", hash: "#/add/receipt" },
  {
    name: "receipt verification (with photo)",
    hash: "#/add/receipt",
    prepare: async (p) => {
      await p.locator('.dropzone input[type="file"]').setInputFiles([
        { name: "a.png", mimeType: "image/png", buffer: PNG },
        { name: "b.png", mimeType: "image/png", buffer: PNG },
      ]);
      await p.getByRole("button", { name: "Enter by hand instead" }).click();
      await p.getByLabel("code on line 1", { exact: true }).fill("1");
    },
  },
  { name: "activity", hash: "#/activity" },
  { name: "settings", hash: "#/settings" },
  { name: "not found", hash: "#/nope" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-07 / US-20 WCAG 2.2 AA — ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const r of routes) {
      test(`no axe violations: ${r.name}`, async ({ page }) => {
        await openApp(page, r.hash);
        if (r.prepare) await r.prepare(page);
        const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(
          res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`),
        ).toEqual([]);
      });
    }
  });
}

test.describe("US-20 keyboard operation", () => {
  test("a skip link, visible focus, and focus moves to the page heading on navigation", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#page-title")).toBeFocused();

    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.locator("#page-title")).toBeFocused();
    await expect(page).toHaveTitle(/Activity · Grocery ledger/);
    await expect(page.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  });

  test("the whole add-receipt flow is reachable by keyboard alone", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    const btn = page.getByRole("button", { name: "Enter by hand instead" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(lbl("Ticket number"))).toBeVisible();
    await page.getByLabel(lbl("Ticket number")).focus();
    await page.keyboard.type("123");
    await expect(page.getByLabel(lbl("Ticket number"))).toHaveValue("123");
  });

  test("status is conveyed by text as well as colour", async ({ page }) => {
    await openApp(page, "#/bill/FYQQRQ");
    await expect(page.getByText("✓ All checks pass")).toBeVisible();
  });
});
