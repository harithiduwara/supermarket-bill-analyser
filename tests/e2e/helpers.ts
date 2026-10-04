import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
import { expect, type Page, type Route } from "@playwright/test";

export const rawBill = (ref: string): string =>
  fs.readFileSync(path.resolve(here, "../../src/seed/raw", `${ref}.md`), "utf8");

export async function openApp(page: Page, hash = "#/ledger"): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Loading your ledger")).toHaveCount(0);
}

/** Label text of a required field includes a decorative " *"; match the name exactly regardless. */
export const lbl = (name: string): RegExp => new RegExp(`^${name}( \\*)?$`);

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Fill the by-hand receipt form with a small, correct Glomark receipt (2 lines). */
export async function fillSmallReceipt(page: Page, ticket = "999001"): Promise<void> {
  await page.getByLabel(lbl("Ticket number")).fill(ticket);
  await page.getByLabel(lbl("Store")).fill("Glomark Kottawa");
  await page.getByLabel(lbl("Date")).fill("2026-10-05");
  await page.getByLabel(lbl("Time")).fill("12:30");
  await page.getByLabel(lbl("Gross")).fill("250.50");
  await page.getByLabel(lbl("Discount")).fill("25");
  await page.getByLabel(lbl("Net")).fill("225.50");
  await page.getByLabel("Method 1").fill("Visa Credit Card-1234");
  await page.getByLabel("Amount 1").fill("225.50");
  const lines = [
    ["1", "100001", "RICE 5KG", "100", "2", "25", "175", "Bank 25%"],
    ["2", "100002", "SOAP", "50.5", "1", "0", "50.5", ""],
  ];
  for (const [i, l] of lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add a line" }).click();
    const n = i + 1;
    const keys = ["ln", "code", "name", "rate", "qty", "discount", "amount", "scheme"];
    for (const [k, key] of keys.entries())
      await page.getByLabel(`${key} on line ${n}`, { exact: true }).fill(l[k]);
  }
}

/** Mock the Anthropic API (incl. the CORS preflight). `replies` are returned in order. */
export async function mockAnthropic(page: Page, replies: object[]): Promise<{ calls: () => number }> {
  let n = 0;
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  await page.route("https://api.anthropic.com/v1/messages", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const input = replies[Math.min(n++, replies.length - 1)];
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ content: [{ type: "tool_use", name: "record_receipt", input }] }),
    });
  });
  return { calls: () => n };
}

import { buildWorkbook } from "../../src/export/xlsx";
import type { Bill } from "../../src/domain/types";
import { allSeed } from "../unit/helpers";

/** A real workbook, built by the app's own exporter, for tests that need a file to import. */
export async function workbookFile(
  bills: Bill[] = allSeed(),
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const data = await buildWorkbook(bills, {
    exportedAt: new Date("2026-10-04T10:00:00Z"),
    appVersion: "test",
  });
  return {
    name: "grocery-ledger-2026-10-04.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(data),
  };
}
