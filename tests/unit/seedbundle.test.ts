import { describe, expect, it } from "vitest";
import { seedBills } from "../../src/domain/seed";
import { allPass, reconcile } from "../../src/domain/reconcile";
import { allSeed } from "./helpers";

describe("NFR-02 the bundled seed the app actually loads", () => {
  it("is the same 24 bills as the Python-verified fixture, all reconciled", () => {
    const bundled = seedBills();
    expect(bundled).toHaveLength(24);
    expect(bundled.every((b) => allPass(reconcile(b)))).toBe(true);
    const key = (b: { ref: string }) => b.ref;
    expect(bundled.map(key).sort()).toEqual(allSeed().map(key).sort());
    for (const b of bundled) {
      const ref = allSeed().find((x) => x.ref === b.ref)!;
      expect([b.gross, b.discount, b.net]).toEqual([ref.gross, ref.discount, ref.net]);
    }
  });
  it("is ordered oldest first", () => {
    const s = seedBills().map((b) => b.date + b.time);
    expect(s).toEqual([...s].sort());
  });
});
