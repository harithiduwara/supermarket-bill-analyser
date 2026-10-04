import { describe, expect, it } from "vitest";
import { exportLedger, ingest, ingestMany, receiptRef, refFromEbillUrl } from "../src/domain/ingest";
import { MemoryStore } from "../src/domain/store";
import type { Bill } from "../src/domain/types";
import { allSeed } from "./helpers";

const seed = allSeed();

describe("ingest", () => {
  it("loads all 24 seed bills", async () => {
    const s = new MemoryStore();
    const r = await ingestMany(s, seed);
    expect(r.filter((x) => x.status === "added")).toHaveLength(24);
    expect((await s.all()).length).toBe(24);
  });

  it("re-ingesting a bill already present changes nothing", async () => {
    const s = new MemoryStore();
    await ingestMany(s, seed);
    const before = JSON.stringify(await exportLedger(s));
    const again = await ingestMany(s, seed);
    expect(again.every((x) => x.status === "duplicate")).toBe(true);
    expect(JSON.stringify(await exportLedger(s))).toBe(before);
  });

  it("an overlapping batch only adds the new bills", async () => {
    const s = new MemoryStore();
    await ingestMany(s, seed.slice(0, 15));
    const r = await ingestMany(s, seed.slice(10));
    expect(r.filter((x) => x.status === "added")).toHaveLength(9);
    expect((await s.all()).length).toBe(24);
  });

  it("a duplicate ref never overwrites, even with different content", async () => {
    const s = new MemoryStore();
    await ingest(s, seed[0]);
    const altered: Bill = { ...structuredClone(seed[0]), store: "SOMEWHERE ELSE" };
    expect((await ingest(s, altered)).status).toBe("duplicate");
    expect((await s.get(seed[0].ref))!.store).toBe(seed[0].store);
  });

  it("a bill failing a check is rejected and not saved", async () => {
    const s = new MemoryStore();
    const bad = structuredClone(seed.find((b) => b.ref === "FYQQRQ")!);
    bad.items[0].amount += 10;
    const r = await ingest(s, bad);
    expect(r.status).toBe("rejected");
    expect(r.checks.find((c) => c.id === "itemsEqualGross")!.ok).toBe(false);
    expect(await s.has("FYQQRQ")).toBe(false);
  });

  it("extracts the ref from a digibill link", () => {
    expect(refFromEbillUrl("https://digibill.keellssuper.com/FYQQRQ")).toBe("FYQQRQ");
    expect(refFromEbillUrl("digibill.keellssuper.com/fyqqrq/")).toBe("FYQQRQ");
    expect(refFromEbillUrl("https://digibill.keellssuper.com/")).toBeNull();
    expect(refFromEbillUrl("nonsense")).toBeNull();
  });
  it("builds a store-prefixed receipt ref", () => {
    expect(receiptRef("glo", "546052")).toBe("GLO546052");
  });
});
