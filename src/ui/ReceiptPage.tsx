import { useMemo, useState } from "react";
import { blankDraft, blankLine, evaluate, fromOcr, lineStatus, type ReceiptDraft } from "../domain/draft";
import { ingest } from "../domain/ingest";
import { mergeDrafts, transcribeImage } from "../domain/ocr";
import type { LedgerStore } from "../domain/store";
import type { IngestResult } from "../domain/types";
import { loadSettings } from "../settings";
import { CheckList } from "./CheckList";

export function ReceiptPage({ store, onSaved }: { store: LedgerStore; onSaved: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<ReceiptDraft>(blankDraft());
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);

  const outcome = useMemo(() => evaluate(draft), [draft]);
  const set = <K extends keyof ReceiptDraft>(k: K, v: ReceiptDraft[K]) => { setDraft((d) => ({ ...d, [k]: v })); setResult(null); };
  const setLine = (i: number, k: string, v: string) => set("lines", draft.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function read() {
    const { apiKey, model } = loadSettings();
    if (!apiKey) { setErr("Add your Anthropic API key under Settings first — or skip OCR and enter the receipt by hand."); return; }
    setBusy(true); setErr(""); setNotes([]);
    try {
      const drafts = [];
      for (const f of files) drafts.push(await transcribeImage(f, { apiKey, model }));
      const { draft: merged, conflicts } = mergeDrafts(drafts);
      setDraft(fromOcr(merged)); setStarted(true); setNotes(conflicts);
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }

  async function save() {
    if (!outcome.bill || !outcome.canSave) return;
    const r = await ingest(store, outcome.bill, files);
    setResult(r);
    if (r.status === "added") { onSaved(); setStarted(false); setDraft(blankDraft()); setFiles([]); }
  }

  return (
    <>
      <div className="card">
        <p>
          Photograph the receipt (several photos for a long one — overlapping lines are matched on line number, not position).
          Claude reads it into the table below. <strong>Nothing is saved until you have checked it and every reconciliation check passes.</strong>
        </p>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <p>
          <button className="primary" disabled={!files.length || busy} onClick={read}>{busy ? "Reading…" : `Read ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}</button>{" "}
          <button className="sec" onClick={() => { setStarted(true); setDraft({ ...blankDraft(), lines: [blankLine(1)] }); }}>Enter by hand instead</button>
        </p>
        {err && <div className="bad">{err}</div>}
        {notes.map((n, i) => <div key={i} className="caveat">{n}</div>)}
      </div>

      {started && (
        <>
          <div className="card">
            <h2>Receipt header</h2>
            <div className="grid">
              <F label="Ref prefix" v={draft.prefix} on={(v) => set("prefix", v)} />
              <F label="Ticket number" v={draft.ticket} on={(v) => set("ticket", v)} />
              <F label="Store" v={draft.store} on={(v) => set("store", v)} />
              <F label="Store code" v={draft.storeCode} on={(v) => set("storeCode", v)} />
              <F label="Date (YYYY-MM-DD)" v={draft.date} on={(v) => set("date", v)} />
              <F label="Time (HH:MM)" v={draft.time} on={(v) => set("time", v)} />
              <F label="Printed gross" v={draft.printedGross} on={(v) => set("printedGross", v)} />
              <F label="Printed discount" v={draft.printedDiscount} on={(v) => set("printedDiscount", v)} />
              <F label="Printed net" v={draft.printedNet} on={(v) => set("printedNet", v)} />
              <F label="Points earned" v={draft.pointsEarned} on={(v) => set("pointsEarned", v)} />
              <F label="Points balance printed" v={draft.pointsBalance} on={(v) => set("pointsBalance", v)} />
              <F label="Loyalty scheme" v={draft.loyaltyScheme} on={(v) => set("loyaltyScheme", v)} />
            </div>
            <h2>Tenders</h2>
            {draft.tenders.map((t, i) => (
              <div key={i} className="grid" style={{ marginBottom: 4 }}>
                <F label="Method" v={t.method} on={(v) => set("tenders", draft.tenders.map((x, j) => (j === i ? { ...x, method: v } : x)))} />
                <F label="Amount" v={t.amount} on={(v) => set("tenders", draft.tenders.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </div>
            ))}
            <button className="sec" onClick={() => set("tenders", [...draft.tenders, { method: "", amount: "" }])}>+ tender</button>
          </div>

          <div className="card scroll">
            <h2>Line items — rate × qty − discount must equal amount</h2>
            <table>
              <thead><tr><th>Ln</th><th>Code</th><th>Name</th><th>Rate</th><th>Qty</th><th>Discount</th><th>Amount</th><th>Scheme</th><th /></tr></thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const st = lineStatus(l);
                  return (
                    <>
                      <tr key={i} className={st.ok ? "" : "badrow"}>
                        {(["ln", "code", "name", "rate", "qty", "discount", "amount", "scheme"] as const).map((k) => (
                          <td key={k}><input aria-label={`${k} line ${i + 1}`} value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} /></td>
                        ))}
                        <td><button className="sec" onClick={() => set("lines", draft.lines.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                      {!st.ok && <tr key={i + "m"}><td colSpan={9} className="bad detail">Line {i + 1}: {st.message}</td></tr>}
                    </>
                  );
                })}
              </tbody>
            </table>
            <button className="sec" onClick={() => set("lines", [...draft.lines, blankLine(draft.lines.length + 1)])}>+ line</button>
          </div>

          <div className="card">
            <h2>Reconciliation</h2>
            {outcome.problems.length > 0 && <ul>{outcome.problems.map((p, i) => <li key={i} className="bad">{p}</li>)}</ul>}
            {outcome.checks.length > 0 && <CheckList checks={outcome.checks} />}
            <button className="primary" disabled={!outcome.canSave} onClick={save}>Save to ledger</button>
            {!outcome.canSave && <span className="bad"> Disabled until every check passes. Fix the transcription against the photo — do not edit the printed totals to match.</span>}
            {result?.status === "duplicate" && <p>{result.ref} is already in the ledger — nothing changed.</p>}
            {result?.status === "added" && <p className="ok">Saved {result.ref}.</p>}
          </div>
        </>
      )}
    </>
  );
}

function F({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <div><label className="f">{label}</label><input value={v} onChange={(e) => on(e.target.value)} /></div>;
}
