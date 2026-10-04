import { expect, test, type Page } from "@playwright/test";
import { fillSmallReceipt, openApp } from "./helpers";

const routes = [
  "#/",
  "#/ledger",
  "#/bill/DEM003",
  "#/bill/GLO900003",
  "#/add/ebill",
  "#/add/receipt",
  "#/activity",
  "#/settings",
];

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe("US-19 capture on a phone (360 px)", () => {
  for (const r of routes) {
    test(`no horizontal page scroll: ${r}`, async ({ page }) => {
      await openApp(page, r);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }

  test("the receipt verification form fits and is usable one-handed", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    await fillSmallReceipt(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Save to ledger" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save to ledger" })).toBeInViewport(); // sticky save bar
  });

  test("tap targets are at least 44 px", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "main button.btn:not(.small), main input:not([type=hidden]):not([type=checkbox]):not([type=file]), main select, nav.primary a",
        ),
      ]
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({
          t: e.tagName + (e.getAttribute("aria-label") ?? e.textContent ?? "").slice(0, 24),
          h: Math.round(e.getBoundingClientRect().height),
        }))
        .filter((x) => x.h < 44),
    );
    expect(small).toEqual([]);
  });

  test("the ledger shows bills as cards, not a cramped table", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("table.cards tbody tr").first().getByRole("link")).toBeInViewport();
    const display = await page
      .locator("table.cards tbody tr")
      .first()
      .evaluate((e) => getComputedStyle(e).display);
    expect(display).toBe("block");
  });
});
