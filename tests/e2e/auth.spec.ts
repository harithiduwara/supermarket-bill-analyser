import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { demoBill, lbl, openApp, registerProfile, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

/** The error message under a form (the toast region also has role=alert, and is empty). */
const formError = (page: Page) => page.locator("p.error[role=alert]");

const signIn = async (page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) => {
  await page.getByLabel(lbl("Email")).fill(email);
  await page.getByLabel(lbl("Password")).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

test.describe("US-28 encrypted profiles", () => {
  test("a new visitor must create a profile first; nothing of the app is reachable before", async ({
    page,
  }) => {
    await page.goto("/#/ledger");
    await expect(page.getByRole("heading", { level: 1, name: "Create your profile" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByText("If you lose both your password and your recovery key")).toBeVisible();
  });

  test("weak passwords and mismatches are refused with a reason; the recovery key step cannot be skipped", async ({
    page,
  }) => {
    await page.goto("/#/");
    await page.getByLabel(lbl("Email")).fill(TEST_EMAIL);
    await page.getByLabel(lbl("Password")).fill("short");
    await expect(page.getByText(/at least 10 characters/)).toBeVisible();
    await page.getByLabel(lbl("Password")).fill(TEST_PASSWORD);
    await page.getByLabel(lbl("Confirm password")).fill("something else entirely");
    await expect(page.getByText("The two passwords are not the same.")).toBeVisible();
    await page.getByLabel(lbl("Confirm password")).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByLabel(/I have saved my recovery key/).check();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("lock, then sign in again: the bills are back; a wrong password says so and shows nothing", async ({
    page,
  }) => {
    await openApp(page, "#/ledger");
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("You locked this profile.")).toBeVisible();
    await expect(page.getByText("24 bills")).toHaveCount(0);

    await signIn(page, TEST_EMAIL, "not the right password");
    await expect(formError(page)).toContainText("Wrong email, password or recovery key.");
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();
  });

  test("an unknown email gets exactly the same message as a wrong password", async ({ page }) => {
    await openApp(page, "#/");
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await signIn(page, "nobody@example.com", TEST_PASSWORD);
    await expect(formError(page)).toHaveText("Wrong email, password or recovery key.");
  });

  test("a reload keeps this tab signed in; a lock does not survive one", async ({ page }) => {
    await openApp(page, "#/ledger");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("it locks itself after the idle time, and activity postpones it", async ({ page }) => {
    await page.clock.install();
    await openApp(page, "#/ledger");
    await page.clock.fastForward("10:00"); // 10 of 15 minutes
    await page.getByRole("heading", { level: 1, name: "Ledger" }).click(); // activity
    await page.clock.fastForward("10:00");
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
    await page.clock.fastForward("16:00"); // idle for longer than the limit
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Locked after a period of inactivity.")).toBeVisible();
  });

  test("forgot the password: the recovery key sets a new one, keeps every bill and issues a new key", async ({
    page,
  }) => {
    await page.goto("/#/");
    const key = await registerProfile(page);
    await page.getByRole("link", { name: "Workbook" }).click();
    await page.getByRole("button", { name: "Load demo data" }).click();
    await expect(page.getByText("Demo data.")).toBeVisible();
    await page.getByRole("button", { name: "Lock", exact: true }).click();

    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await page.getByLabel(lbl("Email")).fill(TEST_EMAIL);
    await page.getByLabel(lbl("Recovery key")).fill("0000-0000-0000-0000-0000-0000-0000-0000");
    await page.getByLabel(lbl("New password")).fill("a brand new passphrase");
    await page.getByLabel(lbl("Confirm password")).fill("a brand new passphrase");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(formError(page)).toContainText("Wrong email, password or recovery key.");

    await page.getByLabel(lbl("Recovery key")).fill(key.toLowerCase());
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Save your recovery key" })).toBeVisible();
    const newKey = (await page.getByLabel("Your recovery key").innerText()).trim();
    expect(newKey).not.toBe(key);
    await page.getByLabel(/I have saved my recovery key/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page.getByText("24 bills", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await signIn(page, TEST_EMAIL, TEST_PASSWORD); // the old password no longer works
    await expect(formError(page)).toBeVisible();
    await signIn(page, TEST_EMAIL, "a brand new passphrase");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("settings: change the password and the auto-lock time; delete the profile", async ({ page }) => {
    await openApp(page, "#/settings");
    await page.getByLabel("Lock automatically after").selectOption("30");
    await expect(page.getByText("Auto-lock set to 30 minutes.")).toBeVisible();

    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel(lbl("Current password")).fill("wrong wrong wrong");
    await page.getByLabel(lbl("New password")).fill("another long passphrase");
    await page.getByLabel(lbl("Confirm new password")).fill("another long passphrase");
    await page.getByRole("button", { name: "Change password" }).last().click();
    await expect(formError(page)).toContainText("That password is not right.");
    await page.getByLabel(lbl("Current password")).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).last().click();
    await expect(page.getByText("Your new recovery key.")).toBeVisible();
    await page.getByRole("button", { name: "I have saved it" }).click();

    await page.getByRole("button", { name: "Delete this profile" }).first().click();
    await page.getByLabel(lbl("Type your email to confirm")).fill(TEST_EMAIL);
    await page.getByLabel(lbl("Password")).fill("another long passphrase");
    await page.getByRole("button", { name: "Delete this profile" }).last().click();
    await expect(page.getByRole("heading", { level: 1, name: "Create your profile" })).toBeVisible();
  });

  test("NFR-15 nothing readable is stored: no bill reference, store name, or email appears in IndexedDB", async ({
    page,
  }) => {
    await openApp(page, "#/ledger");
    const b = demoBill("DEM003");
    const dump = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name!);
      const out: Record<string, unknown> = {};
      for (const name of names) {
        out[name] = await new Promise((resolve, reject) => {
          const req = indexedDB.open(name);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames];
            if (!stores.length) return resolve({});
            const tx = db.transaction(stores, "readonly");
            const res: Record<string, unknown> = {};
            let left = stores.length;
            for (const s of stores) {
              if (s === "resume") {
                left--; // this tab's session keys: non-extractable CryptoKey objects, not data
                continue;
              }
              const st = tx.objectStore(s);
              const rows = st.getAll();
              const keys = st.getAllKeys();
              rows.onsuccess = () => {
                const plain = (rows.result as Record<string, unknown>[]).map((r) =>
                  Object.fromEntries(
                    Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? `bytes:${v.length}` : v]),
                  ),
                );
                keys.onsuccess = () => {
                  res[s] = { keys: keys.result, rows: plain };
                  if (--left === 0) resolve(res);
                };
              };
            }
            if (left === 0) resolve(res);
          };
        });
      }
      return JSON.stringify(out);
    });
    for (const secret of [b.ref, b.store, TEST_EMAIL, "Mattegoda"]) expect(dump).not.toContain(secret);
    expect(dump).toContain("grocery-ledger-p-"); // the encrypted ledger really is there
  });

  test("an unencrypted ledger from before profiles can be moved into the new profile, then it is deleted", async ({
    page,
  }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1, name: "Create your profile" })).toBeVisible();
    const bill = demoBill("DEM003");
    // the schema the app used before profiles (Dexie version 2 = IndexedDB version 20)
    await page.evaluate(async (b) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("grocery-ledger", 20);
        req.onupgradeneeded = () => {
          const db = req.result;
          const bills = db.createObjectStore("bills", { keyPath: "ref" });
          bills.createIndex("date", "date");
          bills.createIndex("source", "source");
          db.createObjectStore("images", { keyPath: "id", autoIncrement: true }).createIndex("ref", "ref");
          db.createObjectStore("meta", { keyPath: "key" });
          const ev = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
          ev.createIndex("at", "at");
          ev.createIndex("ref", "ref");
        };
        req.onsuccess = () => {
          const tx = req.result.transaction("bills", "readwrite");
          tx.objectStore("bills").add(b);
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
        req.onerror = () => reject(req.error);
      });
    }, bill);
    await page.reload();
    await page.getByLabel(lbl("Email")).fill(TEST_EMAIL);
    await expect(page.getByText(/bills already stored unencrypted in this browser/)).toContainText("1");
    await page.getByLabel(lbl("Password")).fill(TEST_PASSWORD);
    await page.getByLabel(lbl("Confirm password")).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByText(/now inside your profile/)).toBeVisible();
    await page.getByLabel(/I have saved my recovery key/).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page.getByRole("link", { name: bill.ref })).toBeVisible();
    const left = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(left).not.toContain("grocery-ledger");
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`US-28 / NFR-07 sign-in screens meet WCAG 2.2 AA — ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    const axe = async (page: Page) =>
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`);

    test("create profile, recovery key, sign in and reset screens", async ({ page }) => {
      await page.goto("/#/");
      await expect(page.getByRole("heading", { level: 1, name: "Create your profile" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.getByLabel(lbl("Email")).fill(TEST_EMAIL);
      await page.getByLabel(lbl("Password")).fill("short");
      expect(await axe(page)).toEqual([]); // with an inline error showing
      await page.getByLabel(lbl("Password")).fill(TEST_PASSWORD);
      await page.getByLabel(lbl("Confirm password")).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Create profile" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Save your recovery key" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.getByLabel(/I have saved my recovery key/).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Lock", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await signIn(page, TEST_EMAIL, "not the right password");
      await expect(formError(page)).toBeVisible();
      expect(await axe(page)).toEqual([]); // with the error showing
      await page.getByRole("button", { name: "Forgot your password?" }).click();
      expect(await axe(page)).toEqual([]);
    });
  });
}
