import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DexieStore } from "../src/db/db";
import { ingestMany } from "../src/domain/ingest";
import { allSeed } from "./helpers";

describe("IndexedDB store", () => {
  it("is idempotent across repeated seeding and refuses to overwrite", async () => {
    const s = new DexieStore("test-ledger");
    const seed = allSeed();
    await ingestMany(s, seed);
    await ingestMany(s, seed);
    expect((await s.all()).length).toBe(24);
    await expect(s.add(seed[0])).rejects.toThrow(/already in ledger/);
    const back = await s.get("FYQQRQ");
    expect(back?.net).toBe(seed.find((b) => b.ref === "FYQQRQ")!.net);
  });
});
