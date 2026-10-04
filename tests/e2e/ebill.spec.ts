import { expect, test } from "@playwright/test";
import { demoBill, openApp, rawBill } from "./helpers";

const url = "https://digibill.keellssuper.com/";

test.describe("e-bill ingest", () => {
  test("US-01 a pasted bill is parsed, reconciled and saved; then US-03 re-submitting changes nothing", async ({
    page,
  }) => {
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill(`${url}TEST01`);
    await page.getByLabel(/Paste the page text/).fill(rawBill("DEM003"));
    await expect(page.getByText("Reference detected: TEST01")).toBeVisible();
    await expect(page.getByText("✓ Pass", { exact: true })).toHaveCount(5);
    await page.getByRole("button", { name: "Save to ledger" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved TEST01" }).first()).toBeVisible();

    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page.getByText("25 bills", { exact: true })).toBeVisible();

    // the same reference again — even with different content — is a no-op
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill(`${url}TEST01`);
    await page.getByLabel(/Paste the page text/).fill(rawBill("DEM005"));
    await page.getByRole("button", { name: "Save to ledger" }).click();
    await expect(page.getByText("TEST01 is already in the ledger — nothing was changed.")).toBeVisible();
    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page.getByText("25 bills", { exact: true })).toBeVisible();
  });

  test("US-04 a corrupted bill is blocked, names the failing check and shows the arithmetic", async ({
    page,
  }) => {
    // corrupt the first line's amount by +10 in the page text; every other figure is untouched
    const original = rawBill("DEM003");
    const lines = original.split("\n");
    const row = lines.findIndex((l) => /^\| 1\s+\|/.test(l));
    lines[row] = lines[row].replace(
      /([\d,]+\.\d{2})(\s*\|\s*)$/,
      (_m, amt: string, tail: string) => `${(Number(amt.replace(/,/g, "")) + 10).toFixed(2)}${tail}`,
    );
    const bad = lines.join("\n");
    expect(bad).not.toBe(original);
    const gross = demoBill("DEM003").gross.toLocaleString("en-US", { minimumFractionDigits: 2 });
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill("BAD001");
    await page.getByLabel(/Paste the page text/).fill(bad);
    await expect(page.getByRole("button", { name: "Save to ledger" })).toBeDisabled();
    await expect(page.getByText("✕ FAIL")).toBeVisible();
    await expect(page.getByText(`printed gross ${gross} (diff +10.00)`)).toBeVisible();
    await expect(page.getByText(/tolerance is Rs 0\.02 and is never widened/)).toBeVisible();
  });

  test("US-01 a page with no totals fails loudly instead of defaulting to zero", async ({ page }) => {
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill("EMPTY1");
    await page
      .getByLabel(/Paste the page text/)
      .fill("30-Jul-2026 19:10:52 C:1 R:1\n| 1 | 100001: SOMETHING | 10.00 | 1.0 | 10.00 |");
    await expect(page.getByText(/not guessing it/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save to ledger" })).toBeDisabled();
  });

  test("a link without a bill code is rejected with a reason", async ({ page }) => {
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill("https://digibill.keellssuper.com/");
    await expect(page.getByText("No 6-character bill code found in that link.")).toBeVisible();
  });
});

test.describe("US-01 page source as well as page text", () => {
  test("a bill pasted as an HTML table is converted and parsed", async ({ page }) => {
    // Synthetic markup built from the saved text — NOT the live digibill page (ADR-0002 records that as unverified).
    const rows = rawBill("DEM003")
      .split("\n")
      .filter((l) => l.startsWith("|") && !/^\|[\s|-]*\|$/.test(l.trim()))
      .map(
        (l) =>
          `<tr>${l
            .split("|")
            .slice(1, -1)
            .map((c) => `<td>${c.trim()}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const tail = rawBill("DEM003")
      .split("\n")
      .filter((l) => !l.startsWith("|"))
      .map((l) => `<p>${l}</p>`)
      .join("");
    const html = `<html><head><style>.x{}</style><script>var a=1</script></head><body><table>${rows}</table>${tail}</body></html>`;
    await openApp(page, "#/add/ebill");
    await page.getByLabel(/Link or 6-character code/).fill("HTML01");
    await page.getByLabel(/Paste the page text/).fill(html);
    await expect(page.getByText("Reference detected: HTML01")).toBeVisible();
    await expect(page.getByText("This page could not be read.")).toHaveCount(0);
    await expect(page.getByText("✓ Pass", { exact: true })).toHaveCount(5); // really parsed and reconciled
    await expect(page.getByRole("button", { name: "Save to ledger" })).toBeEnabled();
  });
});
