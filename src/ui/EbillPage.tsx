import { useMemo, useState } from "react";
import { ingest, refFromEbillUrl } from "../domain/ingest";
import { htmlToText, parseBill } from "../domain/parse";
import { allPass, reconcile } from "../domain/reconcile";
import type { LedgerStore } from "../domain/store";
import type { Bill, CheckResult, IngestResult } from "../domain/types";
import { CheckList } from "./CheckList";

export function EbillPage({ store, onSaved }: { store: LedgerStore; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);

  const ref = refFromEbillUrl(url);
  const parsed = useMemo<{ bill?: Bill; error?: string }>(() => {
    if (!text.trim() || !ref) return {};
    try { return { bill: parseBill(htmlToText(text), ref) }; } catch (e) { return { error: String((e as Error).message) }; }
  }, [text, ref]);

  const checks: CheckResult[] = useMemo(() => (parsed.bill ? reconcile(parsed.bill) : []), [parsed.bill]);

  async function save() {
    if (!parsed.bill) return;
    const r = await ingest(store, parsed.bill);
    setResult(r);
    if (r.status === "added") { onSaved(); setText(""); setUrl(""); }
  }

  return (
    <>
      <div className="card">
        <p>
          Paste the bill link, then the page's content. A browser cannot fetch <code>digibill.keellssuper.com</code> from
          this site (the host does not allow cross-origin requests), so open the link yourself, select the whole page,
          copy and paste it below. Page text or page source both work.
        </p>
        <label className="f">Bill link (or just the 6-character code)</label>
        <input value={url} onChange={(e) => { setUrl(e.target.value); setResult(null); }} placeholder="https://digibill.keellssuper.com/FYQQRQ" />
        {url && !ref && <div className="bad">Could not find a 6-character bill code in that link.</div>}
        <label className="f" style={{ marginTop: 8 }}>Page content</label>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} />
      </div>
      {parsed.error && <div className="card bad"><strong>Could not parse this page.</strong> {parsed.error}<div className="detail">If this is a real bill, the page layout may have changed — report it rather than editing figures to fit.</div></div>}
      {parsed.bill && (
        <div className="card">
          <h2>{parsed.bill.ref} — {parsed.bill.store}, {parsed.bill.date} {parsed.bill.time}</h2>
          <p>{parsed.bill.items.length} lines · gross {parsed.bill.gross.toFixed(2)} · discount {parsed.bill.discount.toFixed(2)} · net {parsed.bill.net.toFixed(2)}</p>
          <CheckList checks={checks} />
          <button className="primary" disabled={!allPass(checks)} onClick={save}>Save to ledger</button>
          {!allPass(checks) && <span className="bad"> Blocked: fix the transcription or report a parser bug — tolerance is Rs 0.02 and is not widened.</span>}
        </div>
      )}
      {result?.status === "added" && <div className="card ok">Saved {result.ref}.</div>}
      {result?.status === "duplicate" && <div className="card">{result.ref} is already in the ledger — nothing changed.</div>}
      {result?.status === "rejected" && <div className="card bad">{result.ref} was not saved: a reconciliation check failed.</div>}
    </>
  );
}
