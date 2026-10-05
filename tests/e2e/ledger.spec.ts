import { expect, test } from "@playwright/test";
import { demoBill, openApp } from "./helpers";

test.describe("US-05 browse the ledger", () => {
  test("24 imported bills are listed, all reconciled, with the Keells caveat attached (NFR-12)", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "DEM003" })).toBeVisible();
    await expect(page.getByText("✕ Failed")).toHaveCount(0);
    await expect(page.getByText("Keells totals are a floor, not a measurement.")).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "a floor" })).toBeVisible();
  });

  test("filters by source, month and text, and can be cleared", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Source").selectOption("glomark");
    await expect(page.getByText("3 of 24 bills match")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search").fill("dem003");
    await expect(page.getByText("1 of 24 bills match")).toBeVisible();
    await page.getByLabel("Search").fill("nothing-like-this");
    await expect(page.getByRole("heading", { name: "No bills match" })).toBeVisible();
  });

  test("sorts by a column header and exposes the sort state", async ({ page }) => {
    await openApp(page);
    const net = page.getByRole("columnheader", { name: /Net/ });
    await net.getByRole("button").click();
    await expect(net).toHaveAttribute("aria-sort", "descending");
    await net.getByRole("button").click();
    await expect(net).toHaveAttribute("aria-sort", "ascending");
  });

  test("a bill opens on its own stable link, shows every check, and survives a reload and Back", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("link", { name: "DEM003" }).click();
    await expect(page).toHaveURL(/#\/bill\/DEM003$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(demoBill("DEM003").store);
    await expect(page.getByText("✓ Pass", { exact: true })).toHaveCount(5);
    await expect(page.getByText("Original e-bill text")).toBeVisible();
    await expect(page.getByText("Keells totals are a floor, not a measurement.")).toBeVisible(); // NFR-12: also on a Keells bill
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(demoBill("DEM003").store);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
  });

  test("an unknown bill says so, instead of crashing", async ({ page }) => {
    await openApp(page, "#/bill/NOPE99");
    await expect(page.getByRole("heading", { name: "Bill not found" })).toBeVisible();
  });
});
