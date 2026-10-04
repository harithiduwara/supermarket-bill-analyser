import { expect, test } from "@playwright/test";
import { fillSmallReceipt, mockAnthropic, openApp, PNG, lbl } from "./helpers";

const save = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Save to ledger" });

test.describe("US-02 photo receipt with confirmation", () => {
  test("by hand: Save stays disabled until every check passes, a wrong digit blocks it, fixing it saves", async ({
    page,
  }) => {
    await openApp(page, "#/add/receipt");
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    await expect(save(page)).toBeDisabled();
    await fillSmallReceipt(page);
    await expect(page.getByText("✓ All checks pass")).toBeVisible();
    await expect(save(page)).toBeEnabled();

    // one wrong digit on a line
    await page.getByLabel("amount on line 1", { exact: true }).fill("185");
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText(/✕ Fix — 100 × 2 − 25 = 175\.00, receipt says 185\.00/)).toBeVisible();
    await expect(page.getByText(/line 1 · 1 line to fix|1 line to fix/)).toBeVisible();

    await page.getByLabel("amount on line 1", { exact: true }).fill("175");
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved GLO999001" }).first()).toBeVisible();
    await page.getByRole("link", { name: "View the bill" }).click();
    await expect(page.getByText("✓ Pass", { exact: true })).toHaveCount(5);
  });

  test("a blank printed total is a problem, never a zero", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    await fillSmallReceipt(page);
    await page.getByLabel(lbl("Discount")).fill("");
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText(/Printed discount is blank or unreadable/)).toBeVisible();
  });

  test("a wrong printed total is caught by the bill-level checks", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    await page.getByRole("button", { name: "Enter by hand instead" }).click();
    await fillSmallReceipt(page);
    await page.getByLabel(lbl("Net")).fill("226.50");
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText("✕ FAIL").first()).toBeVisible();
  });

  test("two overlapping photos are read, merged on line number and saved with the photos kept", async ({
    page,
  }) => {
    await mockAnthropic(page, [
      {
        store: "Glomark Kottawa",
        store_code: "14006",
        ticket: "999002",
        date: "2026-10-05",
        time: "12:30",
        printed_gross: null,
        printed_discount: null,
        printed_net: null,
        points_earned: null,
        points_balance: null,
        loyalty_scheme: null,
        tenders: [],
        lines: [
          {
            ln: 1,
            code: "100001",
            name: "RICE 5KG",
            rate: 100,
            qty: 2,
            discount: 25,
            amount: 175,
            scheme: "Bank 25%",
          },
          {
            ln: 2,
            code: "100002",
            name: "SOAP",
            rate: 50.5,
            qty: 1,
            discount: 0,
            amount: 50.5,
            scheme: null,
          },
        ],
      },
      {
        store: null,
        store_code: null,
        ticket: null,
        date: null,
        time: null,
        printed_gross: 270.5,
        printed_discount: 25,
        printed_net: 245.5,
        points_earned: null,
        points_balance: null,
        loyalty_scheme: null,
        tenders: [{ method: "Visa Credit Card-1234", amount: 245.5 }],
        lines: [
          {
            ln: 2,
            code: "100002",
            name: "SOAP",
            rate: 50.5,
            qty: 1,
            discount: 0,
            amount: 50.5,
            scheme: null,
          },
          {
            ln: 3,
            code: "100003",
            name: "TEA 100G",
            rate: 20,
            qty: 1,
            discount: 0,
            amount: 20,
            scheme: null,
          },
        ],
      },
    ]);
    await openApp(page, "#/add/receipt");
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("API key").fill("sk-ant-test");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("link", { name: "Add receipt" }).click();

    await page.locator('.dropzone input[type="file"]').setInputFiles([
      { name: "top.png", mimeType: "image/png", buffer: PNG },
      { name: "bottom.png", mimeType: "image/png", buffer: PNG },
    ]);
    await page.getByRole("button", { name: "Read 2 photos" }).click();
    await expect(page.getByLabel("code on line 3", { exact: true })).toHaveValue("100003");
    await expect(page.getByLabel("code on line 4", { exact: true })).toHaveCount(0); // overlap line 2 not duplicated
    await expect(page.getByRole("region", { name: "Receipt photo" })).toBeVisible(); // original beside the table
    await expect(page.getByText("✓ All checks pass")).toBeVisible();
    await save(page).click();
    await page.getByRole("link", { name: "View the bill" }).click();
    await expect(page.getByRole("region", { name: "Receipt photo" })).toBeVisible(); // stored with the bill
  });

  test("two photos that disagree on a line are reported, not hidden", async ({ page }) => {
    const line = (amount: number) => ({
      ln: 1,
      code: "100001",
      name: "RICE",
      rate: 100,
      qty: 1,
      discount: 0,
      amount,
      scheme: null,
    });
    const base = {
      store: null,
      store_code: null,
      ticket: null,
      date: null,
      time: null,
      printed_gross: null,
      printed_discount: null,
      printed_net: null,
      points_earned: null,
      points_balance: null,
      loyalty_scheme: null,
      tenders: [],
    };
    await mockAnthropic(page, [
      { ...base, lines: [line(100)] },
      { ...base, lines: [line(190)] },
    ]);
    await openApp(page, "#/settings");
    await page.getByLabel("API key").fill("sk-ant-test");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("link", { name: "Add receipt" }).click();
    await page.locator('.dropzone input[type="file"]').setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "b.png", mimeType: "image/png", buffer: PNG },
    ]);
    await page.getByRole("button", { name: "Read 2 photos" }).click();
    await expect(page.getByText(/line 1: photo 2 disagrees on amount/)).toBeVisible();
  });

  test("reading without an API key explains what to do", async ({ page }) => {
    await openApp(page, "#/add/receipt");
    await page
      .locator('.dropzone input[type="file"]')
      .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Read 1 photo" }).click();
    await expect(page.getByText(/Add your Anthropic API key in Settings first/)).toBeVisible();
  });

  test("an API failure is shown and nothing is invented", async ({ page }) => {
    await page.route("https://api.anthropic.com/v1/messages", (r) =>
      r.request().method() === "OPTIONS"
        ? r.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "*",
              "access-control-allow-methods": "POST",
            },
          })
        : r.fulfill({
            status: 401,
            headers: { "access-control-allow-origin": "*" },
            body: "invalid x-api-key",
          }),
    );
    await openApp(page, "#/settings");
    await page.getByLabel("API key").fill("sk-ant-bad");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("link", { name: "Add receipt" }).click();
    await page
      .locator('.dropzone input[type="file"]')
      .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Read 1 photo" }).click();
    await expect(page.getByText(/Anthropic API 401/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receipt details" })).toHaveCount(0);
  });
});
