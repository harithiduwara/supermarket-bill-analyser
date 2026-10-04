import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { DexieStore } from "../../src/db/db";
import { allSeed } from "./helpers";

describe("NFR-11 local database upgrade", () => {
  it("v1 -> v2 keeps existing bills and adds the audit log", async () => {
    const name = "migration-test";
    const bill = allSeed().find((b) => b.ref === "FYQQRQ")!;

    // a database exactly as Phase 1 shipped it (schema v1, no events table)
    const v1 = new Dexie(name);
    v1.version(1).stores({ bills: "ref, date, source", images: "++id, ref", meta: "key" });
    await v1.table("bills").add(bill);
    await v1.table("meta").put({ key: "seeded", value: "1" });
    v1.close();

    const s = new DexieStore(name);
    expect((await s.all()).map((b) => b.ref)).toEqual(["FYQQRQ"]);
    expect(await s.getMeta("seeded")).toBe("1");
    await s.log({ type: "added", ref: "X" });
    expect((await s.events())[0]).toMatchObject({ type: "added", ref: "X" });
  });
});
