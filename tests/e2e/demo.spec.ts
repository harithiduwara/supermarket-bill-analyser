import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { openApp, rawBill } from "./helpers";

async function addEbill(page: Page, ref: string) {
  await openApp(page, "#/add/ebill", "empty");
  await page.getByLabel(/Link or 6-character code/).fill(`https://digibill.keellssuper.com/${ref}`);
  await page.getByLabel(/Paste the page text/).fill(rawBill("DEM003"));
  await page.getByRole("button", { name: "Save to ledger" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Saved ${ref}` })
      .first(),
  ).toBeVisible();
}

test.describe("US-26 demo data is clearly fake, removable, and never exported", () => {
  test("a new visitor starts empty; loading the demo is a choice, and the demo is labelled everywhere", async ({
    page,
  }) => {
    await openApp(page, "#/", "empty");
    await expect(page.getByText("Bills in the ledger")).toBeVisible();
    await page.getByRole("button", { name: "Load demo data" }).click();
    await expect(page.getByText("Demo data.")).toBeVisible();
    await expect(page.getByText(/24 of the bills here are invented/)).toBeVisible();

    await openApp(page, "#/ledger", "empty");
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
    await expect(page.getByText("Demo data.")).toBeVisible();
    await expect(page.getByText("demo", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "DEM003" }).click();
    await expect(page.getByText("Demo data.")).toBeVisible(); // on the bill page too
  });

  test("with only demo bills there is nothing to export, and the page says why", async ({ page }) => {
    await openApp(page, "#/", "demo");
    await expect(page.getByRole("button", { name: "Download workbook (.xlsx)" })).toBeDisabled();
    await expect(
      page.getByText(/nothing of yours to export yet. Demo bills are never included/i),
    ).toBeVisible();
  });

  test("removing the demo data empties the ledger and is recorded in Activity", async ({ page }) => {
    await openApp(page, "#/", "demo");
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Removed 24 demo bills." }).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.getByText("24 demo bills removed")).toBeVisible();
  });

  test("your own bill and the demo can coexist; the workbook has only yours; removing the demo keeps yours", async ({
    page,
  }) => {
    await openApp(page, "#/", "demo"); // a visitor looks around first…
    await addEbill(page, "MINE01"); // …then adds a real bill
    await openApp(page, "#/", "empty");
    await expect(page.getByText("Demo data.")).toBeVisible();
    await expect(page.getByText("Bills in the ledger")).toBeVisible();

    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download workbook (.xlsx)" }).click(),
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await dl.path())!);
    const refs: string[] = [];
    wb.getWorksheet("Data_Bills")!.eachRow((r, n) => n > 1 && refs.push(String(r.getCell(1).value)));
    expect(refs).toEqual(["MINE01"]); // not one demo bill left the app

    await page.getByRole("button", { name: "Remove demo data" }).click();
    await openApp(page, "#/ledger", "empty");
    await expect(
      page.getByText("1 bills", { exact: true }).or(page.getByText("1 bill", { exact: true })),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "MINE01" })).toBeVisible();
    await expect(page.getByText("Demo data.")).toHaveCount(0);
  });

  test("demo bills exported by mistake in a JSON backup are impossible: the backup holds only your bills", async ({
    page,
  }) => {
    await openApp(page, "#/settings", "demo");
    await expect(page.getByText(/0 bills in this browser|24 bills in this browser/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Export JSON backup/ })).toBeVisible();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export JSON backup/ }).click(),
    ]);
    const fs = await import("node:fs");
    const json = JSON.parse(fs.readFileSync((await dl.path())!, "utf8"));
    expect(json.bills).toEqual([]);
  });
});
