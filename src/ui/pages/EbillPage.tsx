import { useMemo, useState } from "react";
import { ingest, refFromEbillUrl } from "../../domain/ingest";
import { htmlToText, parseBill } from "../../domain/parse";
import { allPass, reconcile } from "../../domain/reconcile";
import type { Bill, IngestResult } from "../../domain/types";
import { CheckList } from "../components/CheckList";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context";
import { fmtDate, rs } from "../format";
import { href } from "../router";

export function EbillPage({ onSaved }: { onSaved: () => Promise<void> }) {
  const { store, toast } = useApp();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const ref = refFromEbillUrl(url);
  const parsed = useMemo<{ bill?: Bill; error?: string }>(() => {
    if (!text.trim() || !ref) return {};
    try {
      return { bill: parseBill(htmlToText(text), ref) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [text, ref]);
  const checks = useMemo(() => (parsed.bill ? reconcile(parsed.bill) : []), [parsed.bill]);
  const canSave = !!parsed.bill && allPass(checks) && !busy;

  const reset = () => {
    setUrl("");
    setText("");
    setResult(null);
  };

  async function paste() {
    try {
      setText(await navigator.clipboard.readText());
      setResult(null);
    } catch {
      toast("The browser blocked clipboard access — paste into the box with Ctrl+V instead.", "bad");
    }
  }

  async function save() {
    if (!parsed.bill) return;
    setBusy(true);
    try {
      const r = await ingest(store, parsed.bill, { via: "ebill" });
      setResult(r);
      if (r.status === "added") {
        await onSaved();
        toast(`Saved ${r.ref}.`);
      }
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add a Keells e-bill"
        lead="Open the bill link yourself, copy the whole page, and paste it here. A browser cannot fetch the bill directly from this site, and nothing is sent to a third party."
      />
      <div className="steps">
        <section className="card step" aria-labelledby="s1">
          <h2 id="s1">Bill link</h2>
          <Field
            label="Link or 6-character code"
            value={url}
            required
            inputMode="url"
            autoComplete="off"
            placeholder="https://digibill.keellssuper.com/FYQQRQ"
            hint={ref ? `Reference detected: ${ref}` : "The reference is the last part of the link."}
            error={url && !ref ? "No 6-character bill code found in that link." : undefined}
            onChange={(v) => {
              setUrl(v);
              setResult(null);
            }}
          />
        </section>

        <section className="card step" aria-labelledby="s2">
          <h2 id="s2">Page content</h2>
          <label className="field-label" htmlFor="page-text">
            Paste the page text, or its source
          </label>
          <textarea
            id="page-text"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={paste}>
              Paste from clipboard
            </button>
            <button className="btn" onClick={reset} disabled={!url && !text}>
              Clear
            </button>
          </div>
        </section>

        <section className="card step" aria-labelledby="s3" aria-live="polite">
          <h2 id="s3">Review and save</h2>
          {!text.trim() && <p className="muted">Waiting for the page content.</p>}
          {text.trim() && !ref && (
            <p className="muted">Enter the bill link above so the bill can be given its reference.</p>
          )}
          {parsed.error && (
            <div className="banner bad" role="alert">
              <strong>This page could not be read.</strong> {parsed.error}
              <p className="small">
                If this is a genuine bill the page layout may have changed. Try pasting the visible page text
                instead of its source, and report it rather than editing figures to fit.
              </p>
            </div>
          )}
          {parsed.bill && (
            <>
              <p>
                <strong>{parsed.bill.store}</strong> · {fmtDate(parsed.bill.date)} {parsed.bill.time} ·{" "}
                {parsed.bill.items.length} lines · gross {rs(parsed.bill.gross)} · discount{" "}
                {rs(parsed.bill.discount)} · net <strong>{rs(parsed.bill.net)}</strong>
              </p>
              <CheckList checks={checks} />
              {!allPass(checks) && (
                <div className="banner bad" role="alert">
                  Not saved. A check failed — the tolerance is Rs 0.02 and is never widened. Either the page
                  was copied incompletely or the parser needs a fix; do not alter figures to make it pass.
                </div>
              )}
            </>
          )}
          {result?.status === "added" && (
            <div className="banner ok" role="status">
              Saved <strong>{result.ref}</strong>. <a href={href.bill(result.ref)}>View the bill</a> ·{" "}
              <button className="btn small" onClick={reset}>
                Add another
              </button>
            </div>
          )}
          {result?.status === "duplicate" && (
            <div className="banner info" role="status">
              {result.ref} is already in the ledger — nothing was changed.
            </div>
          )}
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {busy ? "Saving…" : "Save to ledger"}
          </button>
        </section>
      </div>
    </>
  );
}
