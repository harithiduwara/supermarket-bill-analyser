import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { seedLedger } from "../../src/domain/ingest";
import { MemoryStore } from "../../src/domain/store";
import type { Bill } from "../../src/domain/types";
import { canonical, ledgerChecksum } from "../../src/domain/workbook";
import { buildWorkbook, MAX_WORKBOOK_BYTES, readWorkbook, WorkbookError } from "../../src/export/xlsx";
import { billsNotInAnyWorkbook, exportWorkbook, importWorkbook } from "../../src/export/workbookIO";
import { allSeed } from "./helpers";

const seed = allSeed();
const NOW = new Date("2026-10-04T10:00:00Z");
const bill = (ref: string): Bill => structuredClone(seed.find((b) => b.ref === ref)!);
const storeWith = async (bills: Bill[]) => {
  const s = new MemoryStore();
  await seedLedger(s, bills);
  return s;
};
const canon = async (s: MemoryStore) => (await s.all()).map(canonical).sort();

/** Open a workbook, let a test change it the way a person (or attacker) could, write it back. */
async function tamper(buf: ArrayBuffer, edit: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  edit(wb);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const cellOf = (ws: ExcelJS.Worksheet, header: string, row: number) => {
  let col = 0;
  ws.getRow(1).eachCell((c, n) => c.value === header && (col = n));
  return ws.getCell(row, col);
};

describe("US-22 export a workbook", () => {
  it("contains the readable sheets and the data sheets", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(seed, { exportedAt: NOW, appVersion: "9.9.9" }));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Bills",
      "Line Items",
      "Monthly Trend",
      "Sources & Method",
      "About",
      "Data_Bills",
      "Data_Items",
      "Data_Tenders",
      "Data_Promotions",
      "Data_RawText",
    ]);
    expect(wb.getWorksheet("Bills")!.rowCount).toBe(3 + 24 + 1); // title rows, 24 bills, total
    expect(wb.getWorksheet("Data_Bills")!.rowCount).toBe(25);
  });

  it("totals are formulas that already carry their calculated values", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(seed, { exportedAt: NOW, appVersion: "1" }));
    const net = seed.reduce((s, b) => s + b.net, 0);
    const bills = wb.getWorksheet("Bills")!;
    const total = bills.getCell(3 + 24 + 1, 11).value as { formula: string; result: number };
    expect(total.formula).toBe("SUM(K4:K27)");
    expect(total.result).toBeCloseTo(net, 2);
    const summary = wb.getWorksheet("Summary")!;
    const sumNet = summary.getCell("B9").value as { formula: string; result: number };
    expect(sumNet.formula).toMatch(/SUM\(Bills!K4:K27\)/);
    expect(sumNet.result).toBeCloseTo(net, 2);
    const months = wb.getWorksheet("Monthly Trend")!;
    let monthNet = 0;
    for (let r = 4; r <= 7; r++) monthNet += (months.getCell(r, 5).value as { result: number }).result;
    expect(monthNet).toBeCloseTo(net, 2);
  });

  it("EVERY formula cell in the workbook carries a calculated value (a zero must not leave a blank)", async () => {
    // includes bills with no discount, and a month with none: those results are exactly 0
    const buf = await buildWorkbook(seed, { exportedAt: NOW, appVersion: "1" });
    // ExcelJS does not read the flag back, so look at the XML that is actually in the file
    const zip = await JSZip.loadAsync(buf);
    expect(await zip.file("xl/workbook.xml")!.async("string")).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    let formulas = 0;
    const bad: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((c) => {
          const v = c.value as { formula?: string; result?: unknown } | null;
          if (v && typeof v === "object" && "formula" in v) {
            formulas++;
            if (typeof v.result !== "number" || !Number.isFinite(v.result))
              bad.push(`${ws.name}!${c.address} =${v.formula}`);
          }
        }),
      );
    }
    expect(formulas).toBeGreaterThan(50);
    expect(bad).toEqual([]);
    // a bill with no discount shows 0%, as a plain number
    const bills = wb.getWorksheet("Bills")!;
    expect(bills.getCell(5, 12).value).toBe(0);
  });

  it("carries the Keells capture-gap caveat, and Keells figures are labelled a floor", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(seed, { exportedAt: NOW, appVersion: "1" }));
    const texts: string[] = [];
    wb.getWorksheet("Summary")!.eachRow((r) =>
      r.eachCell((c) => typeof c.value === "string" && texts.push(c.value)),
    );
    expect(texts.join("\n")).toMatch(/Keells totals are a floor, not a measurement/);
    expect(texts.join("\n")).toMatch(/a floor, see note/);
  });

  it("re-runs reconciliation at export and flags a bill that no longer ties", async () => {
    const bad = bill("FYQQRQ");
    bad.net += 50;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook([bad], { exportedAt: NOW, appVersion: "1" }));
    expect(String(wb.getWorksheet("Bills")!.getCell(4, 15).value)).toMatch(/Gross − discount = net/);
  });

  it("an empty ledger exports a valid, importable workbook", async () => {
    const buf = await buildWorkbook([], { exportedAt: NOW, appVersion: "1" });
    const r = await importWorkbook(new MemoryStore(), buf);
    expect(r).toMatchObject({ added: 0, billsInFile: 0 });
  });

  it("every figure in the workbook is a printed figure: text that looks like a formula stays text", async () => {
    const b = bill("FYQQRQ");
    b.items[0].name = '=HYPERLINK("http://evil.example","x")';
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook([b], { exportedAt: NOW, appVersion: "1" }));
    for (const sheet of ["Line Items", "Data_Items"]) {
      let found: unknown;
      wb.getWorksheet(sheet)!.eachRow((r) =>
        r.eachCell(
          (c) => typeof c.value === "string" && c.value.startsWith("=HYPERLINK") && (found = c.value),
        ),
      );
      expect(typeof found, sheet).toBe("string");
    }
  });
});

describe("US-24 / NFR-14 the loop: export → import → export, repeatedly", () => {
  it("three full cycles through three separate empty ledgers lose nothing", async () => {
    const original = await storeWith(seed);
    let current = original;
    const checksums: (string | null)[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const out = await exportWorkbook(current, { appVersion: "1", now: NOW });
      const next = new MemoryStore();
      const r = await importWorkbook(next, out.data);
      expect(r).toMatchObject({
        added: 24,
        duplicate: 0,
        rejected: [],
        invalid: [],
        conflicts: [],
        checksum: "match",
      });
      expect(await canon(next)).toEqual(await canon(original));
      checksums.push(r.meta.checksum);
      current = next;
    }
    expect(new Set(checksums).size).toBe(1);
    expect(checksums[0]).toBe(await ledgerChecksum(seed));
  });

  it("two exports of the same ledger hold identical data", async () => {
    const s = await storeWith(seed);
    const a = await readWorkbook((await exportWorkbook(s, { appVersion: "1", now: NOW })).data);
    const b = await readWorkbook(
      (await exportWorkbook(s, { appVersion: "1", now: new Date("2026-12-01T00:00:00Z") })).data,
    );
    expect(b.tables).toEqual(a.tables);
    expect(b.meta.checksum).toBe(a.meta.checksum);
  });

  it("importing the same workbook again changes nothing", async () => {
    const s = await storeWith(seed);
    const { data } = await exportWorkbook(s, { appVersion: "1", now: NOW });
    const before = await canon(s);
    const r = await importWorkbook(s, data);
    expect(r).toMatchObject({ added: 0, duplicate: 24, conflicts: [], checksum: "match", notInFile: 0 });
    expect(await canon(s)).toEqual(before);
  });
});

describe("US-23 import a workbook and keep going", () => {
  it("merges an old workbook into a ledger that already has new bills; reports what the file lacks", async () => {
    const old = await storeWith(seed.slice(0, 15));
    const { data } = await exportWorkbook(old, { appVersion: "1", now: NOW });
    const current = await storeWith(seed.slice(10)); // 10..23: overlaps 10..14, has 9 bills the file lacks
    const r = await importWorkbook(current, data);
    expect(r).toMatchObject({
      added: 10,
      duplicate: 5,
      billsInFile: 15,
      notInFile: 9,
      conflicts: [],
      rejected: [],
      invalid: [],
    });
    expect((await current.all()).length).toBe(24);
    expect(await canon(current)).toEqual(await canon(await storeWith(seed)));
  });

  it("the daily loop: import last workbook → add a new bill → export → the new file has everything", async () => {
    const first = await storeWith(seed);
    const week1 = (await exportWorkbook(first, { appVersion: "1", now: NOW })).data;

    const fresh = new MemoryStore(); // a new browser / a new day
    await importWorkbook(fresh, week1);
    const newBill = { ...bill("FYQQRQ"), ref: "NEW001" };
    await fresh.add(newBill);
    expect(await billsNotInAnyWorkbook(fresh)).toEqual(["NEW001"]);
    const week2 = (await exportWorkbook(fresh, { appVersion: "1", now: new Date("2026-10-11T00:00:00Z") }))
      .data;
    expect(await billsNotInAnyWorkbook(fresh)).toEqual([]);

    const later = new MemoryStore();
    const r = await importWorkbook(later, week2);
    expect(r.added).toBe(25);
    expect((await later.get("NEW001"))!.net).toBe(newBill.net);
  });

  it("never overwrites a bill the ledger has; a differing copy in the file is reported by reference", async () => {
    const s = await storeWith(seed);
    const { data } = await exportWorkbook(s, { appVersion: "1", now: NOW });
    const edited = await tamper(data, (wb) => {
      const ws = wb.getWorksheet("Data_Bills")!;
      let row = 0;
      ws.eachRow((r, n) => n > 1 && r.getCell(1).value === "FYQQRQ" && (row = n));
      cellOf(ws, "store", row).value = "Somewhere else";
    });
    const before = await canon(s);
    const r = await importWorkbook(s, edited);
    expect(r.conflicts).toEqual(["FYQQRQ"]);
    expect(r.checksum).toBe("mismatch"); // edited outside the app
    expect(await canon(s)).toEqual(before); // ledger copy kept
  });

  it("a new bill hand-edited in Excel so that it no longer ties is rejected by name, with the failing check", async () => {
    const s = await storeWith(seed.slice(1));
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    const first = seed[0].ref; // the bill the target ledger lacks
    const edited = await tamper(data, (wb) => {
      const ws = wb.getWorksheet("Data_Bills")!;
      let row = 0;
      ws.eachRow((r, n) => n > 1 && r.getCell(1).value === first && (row = n));
      cellOf(ws, "net", row).value = (cellOf(ws, "net", row).value as number) + 100;
    });
    const r = await importWorkbook(s, edited);
    expect(r.added).toBe(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].ref).toBe(first);
    expect(r.rejected[0].failing.length).toBeGreaterThan(0);
    expect(await s.has(first)).toBe(false);
  });

  it("a truncated Data_Items sheet is reported for that bill; the other bills still import", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    const cut = await tamper(data, (wb) => wb.getWorksheet("Data_Items")!.spliceRows(5, 1));
    const s = new MemoryStore();
    const r = await importWorkbook(s, cut);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/declares \d+ lines but contains \d+/);
    expect(r.added).toBe(23);
  });

  it("a formula in a data cell is never evaluated: that bill is refused, the rest import", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    const bad = await tamper(data, (wb) => {
      cellOf(wb.getWorksheet("Data_Bills")!, "gross", 2).value = { formula: "1+1", result: 2 };
    });
    const r = await importWorkbook(new MemoryStore(), bad);
    expect(r.invalid.map((i) => i.reason).join()).toMatch(/gross contains a formula/);
    expect(r.added).toBe(23);
  });

  it("reordered columns and added sheets / formatting do not matter — only names are read", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    const changed = await tamper(data, (wb) => {
      wb.addWorksheet("My own pivot").getCell("A1").value = "hello";
      wb.getWorksheet("Summary")!.getCell("A1").value = "Renamed by the user";
      wb.getWorksheet("Bills")!.spliceRows(5, 3); // damage a readable sheet
    });
    const r = await importWorkbook(new MemoryStore(), changed);
    expect(r).toMatchObject({ added: 24, checksum: "match" });
  });

  it("merges several workbooks in sequence, idempotently", async () => {
    const a = (await exportWorkbook(await storeWith(seed.slice(0, 12)), { appVersion: "1", now: NOW })).data;
    const b = (await exportWorkbook(await storeWith(seed.slice(8)), { appVersion: "1", now: NOW })).data;
    const s = new MemoryStore();
    const r1 = await importWorkbook(s, a);
    const r2 = await importWorkbook(s, b);
    expect([r1.added, r2.added, r2.duplicate]).toEqual([12, 12, 4]);
    expect((await s.all()).length).toBe(24);
  });

  it("records the import and export in the audit trail", async () => {
    const s = await storeWith(seed);
    const { data } = await exportWorkbook(s, { appVersion: "1", now: NOW });
    await importWorkbook(new MemoryStore(), data);
    const ev = await s.events();
    expect(ev[0]).toMatchObject({ type: "export", detail: "workbook, 24 bills" });
    const t = new MemoryStore();
    await importWorkbook(t, data);
    expect((await t.events())[0].detail).toMatch(
      /^workbook exported 2026-10-04: 24 added, 0 already present, 0 failed checks, 0 invalid; checksum match$/,
    );
  });
});

describe("NFR-13 a hostile or wrong file is refused with a plain reason", () => {
  const refuse = (buf: ArrayBuffer | Uint8Array, re: RegExp) =>
    expect(importWorkbook(new MemoryStore(), buf)).rejects.toThrow(re);

  it("not a zip at all", () =>
    refuse(new TextEncoder().encode("hello, I am a text file"), /not an \.xlsx file/));
  it("a zip header with garbage after it", () =>
    refuse(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6]), /could not open this file/));
  it("larger than the cap — refused before it is parsed", () => {
    const big = new Uint8Array(MAX_WORKBOOK_BYTES + 1);
    big[0] = 0x50;
    big[1] = 0x4b;
    return refuse(big, /larger than 20 MB/);
  });
  it("a perfectly good workbook this app did not export", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Bills").addRow(["ref", "net"]);
    await refuse((await wb.xlsx.writeBuffer()) as ArrayBuffer, /not exported by Grocery bill ledger/);
  });
  it("a workbook from a newer version of the app", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    const newer = await tamper(data, (wb) => {
      wb.getWorksheet("About")!.eachRow(
        (r) => r.getCell(1).value === "FormatVersion" && (r.getCell(2).value = 99),
      );
    });
    await refuse(newer, /format v99.*newer version/);
  });
  it("missing the Data_Bills sheet", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    await refuse(await tamper(data, (wb) => wb.removeWorksheet("Data_Bills")), /Data_Bills sheet is missing/);
  });
  it("a Data sheet missing a required column", async () => {
    const { data } = await exportWorkbook(await storeWith(seed), { appVersion: "1", now: NOW });
    await refuse(
      await tamper(data, (wb) => (wb.getWorksheet("Data_Bills")!.getCell(1, 7).value = "renamed")),
      /missing the column\(s\): gross/,
    );
  });
  it("a refused file changes nothing and logs nothing", async () => {
    const s = new MemoryStore();
    await expect(importWorkbook(s, new TextEncoder().encode("nope"))).rejects.toBeInstanceOf(WorkbookError);
    expect(await s.all()).toEqual([]);
    expect(await s.events()).toEqual([]);
  });
});

describe("NFR-08 workbook size and speed", () => {
  it("a 2,000-bill ledger exports and re-imports within a sensible time and size", async () => {
    const big: Bill[] = [];
    for (let i = 0; i < 2000; i++)
      big.push({ ...structuredClone(seed[i % 24]), ref: `B${String(i).padStart(5, "0")}` });
    const t0 = performance.now();
    const buf = await buildWorkbook(big, { exportedAt: NOW, appVersion: "1" });
    const tBuild = performance.now() - t0;
    const t1 = performance.now();
    const read = await readWorkbook(buf);
    const tRead = performance.now() - t1;
    console.log(
      `2,000 bills: build ${Math.round(tBuild)} ms, read ${Math.round(tRead)} ms, ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`,
    );
    expect(read.tables.bills).toHaveLength(2000);
    expect(tBuild).toBeLessThan(30_000);
    expect(tRead).toBeLessThan(30_000);
    expect(buf.byteLength).toBeLessThan(MAX_WORKBOOK_BYTES);
  }, 90_000);
});
