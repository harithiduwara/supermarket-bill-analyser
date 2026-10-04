import { useRef, useState } from "react";
import { exportLedger, ingest } from "../domain/ingest";
import type { LedgerStore } from "../domain/store";
import type { Bill } from "../domain/types";
import { loadSettings, saveSettings } from "../settings";

export function SettingsPage({ store, onChanged }: { store: LedgerStore; onChanged: () => void }) {
  const [s, setS] = useState(loadSettings);
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function doExport() {
    const blob = new Blob([JSON.stringify(await exportLedger(store), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `grocery-ledger-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }
  async function doImport(f: File) {
    try {
      const data = JSON.parse(await f.text());
      if (data.version !== 1 || !Array.isArray(data.bills)) throw new Error("not a ledger export (expected version 1)");
      let added = 0, dup = 0; const bad: string[] = [];
      for (const b of data.bills as Bill[]) {
        const r = await ingest(store, b);
        if (r.status === "added") added++; else if (r.status === "duplicate") dup++; else bad.push(r.ref);
      }
      setMsg(`Imported: ${added} added, ${dup} already present${bad.length ? `, ${bad.length} REJECTED (failed checks): ${bad.join(", ")}` : ""}.`);
      onChanged();
    } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); }
  }

  return (
    <>
      <div className="card">
        <h2>Backup</h2>
        <p>The ledger lives only in this browser (IndexedDB). Clearing site data deletes it, and it does not follow you to another device — export regularly. Receipt photos are not included in the export.</p>
        <button className="sec" onClick={doExport}>Export ledger (JSON)</button>{" "}
        <button className="sec" onClick={() => file.current?.click()}>Import ledger…</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        <p>Import is safe to repeat: bills already present are skipped, and any bill failing a check is rejected.</p>
        {msg && <p>{msg}</p>}
      </div>
      <div className="card">
        <h2>Photo OCR (Anthropic API)</h2>
        <p>Receipt photos are read by Claude, called directly from this page. The key is stored in this browser's localStorage and sent only to api.anthropic.com. Use a key with a spend limit, and do not enter it on a shared computer.</p>
        <label className="f">API key</label>
        <input type="password" autoComplete="off" value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value })} placeholder="sk-ant-…" />
        <label className="f" style={{ marginTop: 8 }}>Model</label>
        <input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
        <p className="muted">Check the current model list in the Anthropic docs; the default is only a starting point and can be changed at any time.</p>
        <button className="sec" onClick={() => { saveSettings(s); setMsg("Settings saved."); }}>Save settings</button>
      </div>
    </>
  );
}
