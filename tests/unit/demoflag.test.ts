import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DexieStore } from "../../src/db/db";
import { exportLedger, importLedger, ingest } from "../../src/domain/ingest";
import { demoLedger, loadDemo, removeDemo } from "../../src/domain/seed";
import { MemoryStore } from "../../src/domain/store";
import { billsNotInAnyWorkbook, exportWorkbook, importWorkbook } from "../../src/export/workbookIO";
import { allSeed } from "./helpers";

describe("US-26 demo data is clearly fake, removable, and never exported", () => {
  it("every demo bill is flagged and reconciles through the normal gate", async () => {
    expect(demoLedger().every((b) => b.demo === true)).toBe(true);
    const s = new MemoryStore();
    const r = await loadDemo(s);
    expect(r.filter((x) => x.status === "added")).toHaveLength(24);
    expect((await s.all()).every((b) => b.demo)).toBe(true);
  });

  it("loading twice changes nothing", async () => {
    const s = new MemoryStore();
    await loadDemo(s);
    const before = JSON.stringify(await s.all());
    const r = await loadDemo(s);
    expect(r.every((x) => x.status === "duplicate")).toBe(true);
    expect(JSON.stringify(await s.all())).toBe(before);
  });

  it("removing deletes the demo bills and ONLY those, and is recorded", async () => {
    const s = new MemoryStore();
    const real = { ...structuredClone(allSeed()[0]), ref: "MINE01" };
    await ingest(s, real);
    await loadDemo(s);
    expect((await s.all()).length).toBe(25);
    expect(await removeDemo(s)).toBe(24);
    expect((await s.all()).map((b) => b.ref)).toEqual(["MINE01"]);
    expect((await s.events())[0]).toMatchObject({ type: "removed", detail: "24 demo bills removed" });
    expect(await removeDemo(s)).toBe(0); // nothing left to remove
  });

  it("the JSON backup and the workbook never contain demo bills", async () => {
    const s = new MemoryStore();
    const real = { ...structuredClone(allSeed()[0]), ref: "MINE01" };
    await ingest(s, real);
    await loadDemo(s);
    expect((await exportLedger(s)).bills.map((b) => b.ref)).toEqual(["MINE01"]);
    const wb = await exportWorkbook(s, { appVersion: "1" });
    const t = new MemoryStore();
    const r = await importWorkbook(t, wb.data);
    expect(r.billsInFile).toBe(1);
    expect((await t.all()).map((b) => b.ref)).toEqual(["MINE01"]);
  });

  it("demo bills do not count as 'not yet in a workbook' — they are not yours to save", async () => {
    const s = new MemoryStore();
    await loadDemo(s);
    expect(await billsNotInAnyWorkbook(s)).toEqual([]);
    await ingest(s, { ...structuredClone(allSeed()[0]), ref: "MINE01" });
    expect(await billsNotInAnyWorkbook(s)).toEqual(["MINE01"]);
  });

  it("a user's own bill with the same reference as a demo bill is not silently replaced", async () => {
    const s = new MemoryStore();
    await loadDemo(s);
    const clash = { ...structuredClone(allSeed()[0]), net: allSeed()[0].net }; // same ref as a demo bill
    expect((await ingest(s, clash)).status).toBe("duplicate"); // idempotent: the demo copy stays until removed
    await removeDemo(s);
    expect((await ingest(s, clash)).status).toBe("added"); // after removal the real one can be added
  });

  it("works against the real IndexedDB store too (bulk delete, photos, audit)", async () => {
    const s = new DexieStore("demo-flag-test");
    await loadDemo(s);
    await s.add({ ...structuredClone(allSeed()[0]), ref: "MINE02" }, [
      new Blob(["x"], { type: "image/png" }),
    ]);
    expect(await removeDemo(s)).toBe(24);
    expect((await s.all()).map((b) => b.ref)).toEqual(["MINE02"]);
    expect(await s.images("MINE02")).toHaveLength(1); // the user's own photo survives
  });

  it("a backup file that contains a demo-flagged bill is accepted as demo (removable), never as real", async () => {
    const s = new MemoryStore();
    const b = demoLedger()[0];
    const r = await importLedger(s, JSON.stringify({ version: 1, bills: [b] }));
    expect(r.added).toBe(1);
    expect((await s.get(b.ref))!.demo).toBe(true);
  });
});
