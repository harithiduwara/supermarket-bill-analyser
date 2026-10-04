import fs from "node:fs";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { allSeed } from "../unit/helpers";
import { openApp, rawBill, workbookFile } from "./helpers";

const fileInput = (page: Page) => page.locator('.dropzone input[type="file"]');
const exportBtn = (page: Page) => page.getByRole("button", { name: "Download workbook (.xlsx)" });

async function addEbill(page: Page, ref: string, from = "FYQQRQ") {
  await openApp(page, "#/add/ebill");
  await page.getByLabel(/Link or 6-character code/).fill(`https://digibill.keellssuper.com/${ref}`);
  await page.getByLabel(/Paste the page text/).fill(rawBill(from));
  await page.getByRole("button", { name: "Save to ledger" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Saved ${ref}` })
      .first(),
  ).toBeVisible();
}

async function download(page: Page): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent("download"), exportBtn(page).click()]);
  expect(dl.suggestedFilename()).toMatch(/^grocery-ledger-\d{4}-\d{2}-\d{2}\.xlsx$/);
  return (await dl.path())!;
}

/** Playwright stores downloads under a random temp name; hand it back to the app under a real one. */
const asUpload = (path: string, name: string) => ({
  name,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: fs.readFileSync(path),
});

test.describe("US-25 the workbook page is the front door", () => {
  test("shows the three steps and where things stand", async ({ page }) => {
    await openApp(page, "#/");
    await expect(page.getByRole("heading", { level: 1, name: "Workbook" })).toBeVisible();
    for (const h of ["Import your last workbook", "Add your new bills", "Export your workbook"]) {
      await expect(page.getByRole("heading", { name: h })).toBeVisible();
    }
    await expect(page.getByText("Bills in the ledger")).toBeVisible();
    await expect(page.getByText(/24 bills are not in any workbook you hold — export again/)).toBeVisible();
  });
});

test.describe("US-22 export a workbook", () => {
  test("downloads a real .xlsx with the readable and data sheets, and the page says it is up to date", async ({
    page,
  }) => {
    await openApp(page, "#/");
    const file = await download(page);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining([
        "Summary",
        "Bills",
        "Line Items",
        "Monthly Trend",
        "About",
        "Data_Bills",
        "Data_Items",
      ]),
    );
    expect(wb.getWorksheet("Data_Bills")!.rowCount).toBe(25);
    await expect(page.getByText("✓ Your workbook is up to date")).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Downloaded grocery-ledger-.*\(24 bills\)/ })
        .first(),
    ).toBeVisible();
  });

  test("adding a bill afterwards says the workbook is out of date again", async ({ page }) => {
    await openApp(page, "#/");
    await download(page);
    await addEbill(page, "NEWBIL");
    await openApp(page, "#/");
    await expect(page.getByText(/1 bill is not in any workbook you hold — export again/)).toBeVisible();
  });
});

test.describe("US-23 / US-24 the loop across sessions", () => {
  test("add a bill → export → a fresh browser imports it and carries on → export again has everything", async ({
    page,
    browser,
    baseURL,
  }) => {
    // day 1
    await addEbill(page, "LOOP01");
    await openApp(page, "#/");
    const day1 = await download(page);

    // day 2, a brand-new browser profile: it only has the starting data
    const ctx = await browser.newContext({ baseURL });
    const p2 = await ctx.newPage();
    await openApp(p2, "#/");
    await fileInput(p2).setInputFiles(asUpload(day1, "grocery-ledger-day1.xlsx"));
    const report = p2.getByRole("status").filter({ hasText: "grocery-ledger-" });
    await expect(report).toContainText("1 added, 24 already present, 0 failed checks, 0 invalid");
    await expect(report).toContainText("contents unchanged since export");
    await expect(report).toContainText("25 bills in the file");

    await addEbill(p2, "LOOP02", "YYLH0T");
    await openApp(p2, "#/");
    await expect(p2.getByText(/1 bill is not in any workbook you hold/)).toBeVisible();
    const day2 = await download(p2);

    // day 3: another fresh profile reads the newest file and has all 26
    const ctx3 = await browser.newContext({ baseURL });
    const p3 = await ctx3.newPage();
    await openApp(p3, "#/");
    await fileInput(p3).setInputFiles(asUpload(day2, "grocery-ledger-day2.xlsx"));
    await expect(p3.getByRole("status").filter({ hasText: "grocery-ledger-" })).toContainText(
      "2 added, 24 already present",
    );
    await openApp(p3, "#/ledger");
    await expect(p3.getByText("26 bills", { exact: true })).toBeVisible();
    await expect(p3.getByRole("link", { name: "LOOP01" })).toBeVisible();
    await expect(p3.getByRole("link", { name: "LOOP02" })).toBeVisible();
    await ctx.close();
    await ctx3.close();
  });

  test("importing the same workbook twice changes nothing the second time", async ({ page }) => {
    await openApp(page, "#/");
    await fileInput(page).setInputFiles(await workbookFile());
    await expect(page.getByRole("status").filter({ hasText: "grocery-ledger-" })).toContainText(
      "0 added, 24 already present",
    );
    await fileInput(page).setInputFiles(await workbookFile());
    await expect(page.getByRole("status").filter({ hasText: "grocery-ledger-" }).last()).toContainText(
      "0 added, 24 already present",
    );
    await openApp(page, "#/ledger");
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
  });

  test("several workbooks at once are merged", async ({ page }) => {
    const seed = allSeed();
    const a = { ...(await workbookFile(seed.slice(0, 5))), name: "a.xlsx" };
    const b = { ...(await workbookFile([{ ...structuredClone(seed[0]), ref: "EXTRA1" }])), name: "b.xlsx" };
    await openApp(page, "#/");
    await fileInput(page).setInputFiles([a, b]);
    await expect(page.getByText(/a\.xlsx.*0 added, 5 already present/)).toBeVisible();
    await expect(page.getByText(/b\.xlsx.*1 added, 0 already present/)).toBeVisible();
    await openApp(page, "#/ledger");
    await expect(page.getByText("25 bills", { exact: true })).toBeVisible();
  });

  test("a bill edited in Excel so it no longer ties is rejected by name; a changed copy of an existing bill is kept as-is and reported", async ({
    page,
  }) => {
    const seed = allSeed();
    const fresh = { ...structuredClone(seed[0]), ref: "EDIT01", net: seed[0].net + 100 }; // does not tie
    const changed = { ...structuredClone(seed[1]), store: "Edited store" }; // already in the ledger, different content
    await openApp(page, "#/");
    await fileInput(page).setInputFiles(await workbookFile([fresh, changed]));
    const report = page.getByRole("status").filter({ hasText: "grocery-ledger-" });
    await expect(report).toContainText(
      "0 added, 1 already present (1 differ from the ledger copy, ledger kept), 1 failed checks",
    );
    await expect(report).toContainText("Rejected EDIT01");
    await expect(report).toContainText(`Kept the ledger's version of ${changed.ref}`);
    await openApp(page, "#/ledger");
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
  });
});

test.describe("NFR-13 a wrong file is refused with a plain reason", () => {
  test("a workbook this app did not export", async ({ page }) => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Bills").addRow(["ref", "net"]);
    await openApp(page, "#/");
    await fileInput(page).setInputFiles({
      name: "someone-elses.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: "someone-elses.xlsx was not imported" }),
    ).toContainText("not exported by Grocery bill ledger");
    await expect(page.getByRole("alert").filter({ hasText: "someone-elses.xlsx" })).toContainText(
      "Nothing was changed",
    );
  });

  test("macro-enabled and legacy Excel formats", async ({ page }) => {
    await openApp(page, "#/");
    await fileInput(page).setInputFiles({
      name: "macro.xlsm",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("PK"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "macro.xlsm" })).toContainText(
      "macro-enabled and legacy Excel files are refused",
    );
    await fileInput(page).setInputFiles({
      name: "old.xls",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "old.xls" })).toContainText("refused");
  });

  test("a file that is not a workbook at all, and a corrupt one", async ({ page }) => {
    await openApp(page, "#/");
    await fileInput(page).setInputFiles({
      name: "notes.xlsx",
      mimeType: "text/plain",
      buffer: Buffer.from("just some text"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "notes.xlsx" })).toContainText(
      "not an .xlsx file",
    );
    await fileInput(page).setInputFiles({
      name: "broken.xlsx",
      mimeType: "application/zip",
      buffer: Buffer.from([0x50, 0x4b, 1, 2, 3, 4, 5, 6]),
    });
    await expect(page.getByRole("alert").filter({ hasText: "broken.xlsx" })).toContainText("could not open");
    await openApp(page, "#/ledger");
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
  });

  test("an unsupported file type is told what to choose", async ({ page }) => {
    await openApp(page, "#/");
    await fileInput(page).setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "photo.png" })).toContainText(
      "choose an .xlsx workbook",
    );
  });

  test("a good file and a bad file together: the good one still imports", async ({ page }) => {
    const extra = {
      ...(await workbookFile([{ ...structuredClone(allSeed()[0]), ref: "GOOD01" }])),
      name: "good.xlsx",
    };
    await openApp(page, "#/");
    await fileInput(page).setInputFiles([
      { name: "bad.xlsx", mimeType: "text/plain", buffer: Buffer.from("nope") },
      extra,
    ]);
    await expect(page.getByText(/good\.xlsx.*1 added/)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "bad.xlsx" })).toBeVisible();
  });
});
