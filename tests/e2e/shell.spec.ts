import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.describe("US-27 app shell and colour theme", () => {
  test("the sidebar groups the destinations, marks the current page and shows the ledger size", async ({
    page,
  }) => {
    await openApp(page, "#/ledger");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveCount(6);
    for (const name of ["Workbook", "Ledger", "Add receipt", "Add e-bill", "Activity", "Settings"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Ledger", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Ledger: 24 bills")).toBeVisible();
    await expect(page.getByText("Stored on this device only")).toBeVisible();
  });

  test("the theme can be forced light or dark, is remembered, and follows the system again", async ({
    page,
  }) => {
    await openApp(page, "#/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /Colour theme/ });
    await expect(html).not.toHaveAttribute("data-theme", /.*/);
    await toggle.click(); // system -> light
    await expect(html).toHaveAttribute("data-theme", "light");
    await toggle.click(); // light -> dark
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAccessibleName(/Colour theme: Dark\. Switch to System/);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark"); // remembered on this device
    await page.getByRole("button", { name: /Colour theme/ }).click(); // dark -> system
    await expect(html).not.toHaveAttribute("data-theme", /.*/);
  });
});
