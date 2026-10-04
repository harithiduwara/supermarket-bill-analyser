import { describe, expect, it } from "vitest";
import { exportLedger, importLedger, ingest } from "../../src/domain/ingest";
import { loadDemo } from "../../src/domain/seed";
import { MemoryStore } from "../../src/domain/store";
import type { Bill } from "../../src/domain/types";
import { allSeed, seedLedger } from "./helpers";

const seed = allSeed();
const clone = (ref: string): Bill => structuredClone(seed.find((b) => b.ref === ref)!);

describe("US-17 audit trail", () => {
  it("records added, duplicate and rejected ingests, newest first", async () => {
    const s = new MemoryStore();
    await ingest(s, clone("DEM003"), { via: "ebill" });
    await ingest(s, clone("DEM003"), { via: "ebill" });
    const bad = clone("DEM005");
    bad.items[0].amount += 10;
    await ingest(s, bad, { via: "ebill" });
    const ev = await s.events();
    expect(ev.map((e) => e.type)).toEqual(["rejected", "duplicate", "added"]);
    expect(ev[0].detail).toMatch(/Line items sum to printed gross/);
    expect(ev.every((e) => e.via === "ebill" && !!e.at)).toBe(true);
  });
  it("loading the demo set writes one summary event, not one per bill", async () => {
    const s = new MemoryStore();
    await loadDemo(s);
    const ev = await s.events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "seed", detail: "24 of 24 demo bills loaded" });
  });
  it("export is logged and stamped", async () => {
    const s = new MemoryStore();
    await seedLedger(s, seed);
    const f = await exportLedger(s, new Date("2026-10-04T10:00:00Z"));
    expect(f.exportedAt).toBe("2026-10-04T10:00:00.000Z");
    expect((await s.events())[0]).toMatchObject({ type: "export", detail: "24 bills" });
  });
  it("events are never edited: the log only grows", async () => {
    const s = new MemoryStore();
    await ingest(s, clone("DEM003"));
    const before = await s.events();
    await ingest(s, clone("DEM003"));
    const after = await s.events();
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(1)).toEqual(before);
  });
});

describe("US-06 import is validated, reconciled and idempotent", () => {
  const file = (bills: unknown[], extra: object = {}) => JSON.stringify({ version: 1, bills, ...extra });

  it("round-trips an export", async () => {
    const a = new MemoryStore();
    await seedLedger(a, seed);
    const raw = JSON.stringify(await exportLedger(a));
    const b = new MemoryStore();
    const r = await importLedger(b, raw);
    expect(r).toMatchObject({ added: 24, duplicate: 0, rejected: [], invalid: [] });
    expect((await b.all()).length).toBe(24);
  });
  it("re-importing the same file changes nothing", async () => {
    const s = new MemoryStore();
    const raw = file(seed);
    await importLedger(s, raw);
    const before = JSON.stringify(await s.all());
    const r = await importLedger(s, raw);
    expect(r.added).toBe(0);
    expect(r.duplicate).toBe(24);
    expect(JSON.stringify(await s.all())).toBe(before);
  });
  it("a bill that fails reconciliation is rejected by name, even from a file", async () => {
    const s = new MemoryStore();
    const bad = clone("DEM003");
    bad.net += 50;
    const r = await importLedger(s, file([bad]));
    expect(r.rejected).toEqual([
      { ref: "DEM003", failing: expect.arrayContaining(["Gross − discount = net"]) },
    ]);
    expect(await s.has("DEM003")).toBe(false);
  });
  it("rejects a file that is not JSON / not a ledger, changing nothing", async () => {
    const s = new MemoryStore();
    await expect(importLedger(s, "{nope")).rejects.toThrow(/not valid JSON/);
    await expect(importLedger(s, JSON.stringify({ version: 2, bills: [] }))).rejects.toThrow(
      /not a ledger export/,
    );
    await expect(importLedger(s, JSON.stringify([1, 2]))).rejects.toThrow(/not a ledger export/);
    expect((await s.all()).length).toBe(0);
    expect((await s.events()).length).toBe(0);
  });
  it("reports shape-invalid bills instead of dropping them silently", async () => {
    const s = new MemoryStore();
    const noItems = { ...clone("DEM003"), ref: "NOITEM", items: [] };
    const badDate = { ...clone("DEM005"), date: "2026-02-31" };
    const badRef = { ...clone("DEM005"), ref: "../../etc" };
    const r = await importLedger(s, file([noItems, badDate, badRef, clone("DEM003")]));
    expect(r.added).toBe(1);
    expect(r.invalid.map((i) => i.ref)).toEqual(["NOITEM", "DEM005", "../../etc"]);
    expect(r.invalid[1].reason).toMatch(/date/);
  });
  it("strips unknown keys and cannot pollute prototypes", async () => {
    const s = new MemoryStore();
    const b = JSON.parse(JSON.stringify(clone("DEM003")));
    b.evil = "<script>";
    const raw = file([b]).replace('"evil"', '"__proto__"').replace('"<script>"', '{"polluted":true}');
    await importLedger(s, raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys((await s.get("DEM003"))!)).not.toContain("evil");
    expect(Object.keys((await s.get("DEM003"))!)).not.toContain("__proto__");
  });
  it("refuses an oversized file before parsing it", async () => {
    const s = new MemoryStore();
    await expect(importLedger(s, " ".repeat(21 * 1024 * 1024))).rejects.toThrow(/larger than 20 MB/);
  });
  it("logs one summary event for the import", async () => {
    const s = new MemoryStore();
    await importLedger(s, file([clone("DEM003")]));
    const ev = await s.events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: "import",
      detail: "1 added, 0 already present, 0 failed checks, 0 invalid",
    });
  });
});
