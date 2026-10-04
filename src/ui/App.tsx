import { useCallback, useEffect, useMemo, useState } from "react";
import { DexieStore } from "../db/db";
import { ingestMany } from "../domain/ingest";
import { seedBills } from "../domain/seed";
import type { Bill } from "../domain/types";
import { EbillPage } from "./EbillPage";
import { LedgerPage } from "./LedgerPage";
import { ReceiptPage } from "./ReceiptPage";
import { SettingsPage } from "./SettingsPage";

type Tab = "ledger" | "ebill" | "receipt" | "settings";

export function App() {
  const store = useMemo(() => new DexieStore(), []);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [tab, setTab] = useState<Tab>("ledger");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => setBills(await store.all()), [store]);

  useEffect(() => {
    (async () => {
      try {
        // Seed once. Idempotent anyway (keyed on ref), the flag just avoids re-parsing every load.
        if ((await store.getMeta("seeded")) !== "1" && (await store.all()).length === 0) {
          const results = await ingestMany(store, seedBills());
          const bad = results.filter((r) => r.status === "rejected");
          if (bad.length) throw new Error(`Seed bills failed reconciliation: ${bad.map((b) => b.ref).join(", ")}`);
          await store.setMeta("seeded", "1");
        }
        await refresh();
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    })();
  }, [store, refresh]);

  return (
    <main>
      <h1>Grocery bill ledger</h1>
      <div className="muted">Keells e-bills and Glomark receipts. Every bill is reconciled before it is saved. Data stays in this browser.</div>
      <nav role="tablist">
        {([["ledger", "Ledger"], ["ebill", "Add Keells e-bill"], ["receipt", "Add photo receipt"], ["settings", "Settings & backup"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label}</button>
        ))}
      </nav>
      {error && <div className="caveat">{error}</div>}
      {bills === null ? <p>Loading…</p> : tab === "ledger" ? <LedgerPage bills={bills} />
        : tab === "ebill" ? <EbillPage store={store} onSaved={refresh} />
        : tab === "receipt" ? <ReceiptPage store={store} onSaved={refresh} />
        : <SettingsPage store={store} onChanged={refresh} />}
    </main>
  );
}
