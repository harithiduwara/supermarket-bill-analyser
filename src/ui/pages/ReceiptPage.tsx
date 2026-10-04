import { useMemo, useRef, useState } from "react";
import {
  blankDraft,
  blankLine,
  evaluate,
  fromOcr,
  lineStatus,
  parseNum,
  type ReceiptDraft,
} from "../../domain/draft";
import { ingest } from "../../domain/ingest";
import { mergeDrafts, transcribeImage, type OcrDraft } from "../../domain/ocr";
import type { IngestResult } from "../../domain/types";
import { settings } from "../../settings";
import { CheckList } from "../components/CheckList";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { PhotoViewer } from "../components/PhotoViewer";
import { useApp } from "../context";
import { href } from "../router";

export function ReceiptPage({ onSaved }: { onSaved: () => Promise<void> }) {
  const { store, toast } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<ReceiptDraft>(blankDraft());
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [over, setOver] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const outcome = useMemo(() => evaluate(draft), [draft]);
  const set = <K extends keyof ReceiptDraft>(k: K, v: ReceiptDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setResult(null);
  };
  const setLine = (i: number, k: string, v: string) =>
    set(
      "lines",
      draft.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    );
  const badLines = draft.lines.filter((l) => !lineStatus(l).ok).length;
  const blank = (v: string) => (started && !v.trim() ? "Required" : undefined);
  const badNum = (v: string) => (started && parseNum(v) === null ? "Enter a number" : undefined);

  const addFiles = (list: FileList | File[]) => {
    const imgs = [...list].filter((f) => f.type.startsWith("image/"));
    if (imgs.length < [...list].length) toast("Only image files can be added.", "bad");
    setFiles((p) => [...p, ...imgs]);
  };

  async function read() {
    const { key } = settings.getApiKey();
    if (!key) {
      setErr("Add your Anthropic API key in Settings first, or choose “Enter by hand”.");
      return;
    }
    abort.current = new AbortController();
    setErr("");
    setNotes([]);
    try {
      const drafts: OcrDraft[] = [];
      for (const [i, f] of files.entries()) {
        setProgress(`Reading photo ${i + 1} of ${files.length}…`);
        drafts.push(
          await transcribeImage(f, { apiKey: key, model: settings.getModel(), signal: abort.current.signal }),
        );
      }
      const { draft: merged, conflicts } = mergeDrafts(drafts);
      setDraft(fromOcr(merged));
      setStarted(true);
      setNotes(conflicts);
    } catch (e) {
      setErr((e as Error).name === "AbortError" ? "Cancelled." : (e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!outcome.bill || !outcome.canSave) return;
    const r = await ingest(store, outcome.bill, { images: files, via: "receipt" });
    setResult(r);
    if (r.status === "added") {
      await onSaved();
      toast(`Saved ${r.ref}.`);
    }
  }

  const reset = () => {
    setStarted(false);
    setDraft(blankDraft());
    setFiles([]);
    setResult(null);
    setNotes([]);
  };
  const failing = outcome.checks.filter((c) => c.applicable && !c.ok).length;

  return (
    <>
      <PageHeader
        title="Add a photo receipt"
        lead="Photograph the receipt, let Claude read it, then check every figure against the photo. Nothing is saved until all reconciliation checks pass."
      />

      {result?.status === "added" ? (
        <div className="banner ok" role="status">
          Saved <strong>{result.ref}</strong>. <a href={href.bill(result.ref)}>View the bill</a> ·{" "}
          <a href={href.workbook}>Export your workbook</a> ·{" "}
          <button className="btn small" onClick={reset}>
            Add another receipt
          </button>
        </div>
      ) : (
        <>
          <div className="steps">
            <section className="card step" aria-labelledby="r1">
              <h2 id="r1">Photos</h2>
              <p className="small muted">
                A long receipt can be several overlapping photos — lines are matched on line number, not
                position.
              </p>
              <label
                className={`dropzone${over ? " over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  addFiles(e.dataTransfer.files);
                }}
              >
                <strong>Take or choose photos</strong>
                <div className="muted small">or drop them here</div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {files.length > 0 && (
                <PhotoStrip files={files} onRemove={(i) => setFiles((p) => p.filter((_, j) => j !== i))} />
              )}
              <div className="row" style={{ marginTop: 12 }}>
                {progress ? (
                  <>
                    <span role="status" aria-live="polite">
                      {progress}
                    </span>
                    <button className="btn" onClick={() => abort.current?.abort()}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" disabled={!files.length} onClick={read}>
                      Read {files.length || ""} photo{files.length === 1 ? "" : "s"}
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setStarted(true);
                        setDraft({ ...blankDraft(), lines: [blankLine(1)] });
                      }}
                    >
                      Enter by hand instead
                    </button>
                  </>
                )}
              </div>
              {err && (
                <div className="banner bad" role="alert" style={{ marginTop: 12 }}>
                  {err}
                </div>
              )}
              {notes.map((n) => (
                <div key={n} className="banner warn" role="note" style={{ marginTop: 8 }}>
                  {n}
                </div>
              ))}
            </section>
          </div>

          {started && (
            <div className={`verify${files.length ? " with-photo" : ""}`}>
              {files.length > 0 && <PhotoViewer files={files} />}
              <div>
                <section className="card" aria-labelledby="h-h">
                  <h2 id="h-h">Receipt details</h2>
                  <div className="grid">
                    <Field
                      label="Reference prefix"
                      value={draft.prefix}
                      required
                      onChange={(v) => set("prefix", v)}
                      error={blank(draft.prefix)}
                      hint="GLO for Glomark"
                    />
                    <Field
                      label="Ticket number"
                      value={draft.ticket}
                      required
                      inputMode="numeric"
                      onChange={(v) => set("ticket", v)}
                      error={blank(draft.ticket)}
                    />
                    <Field
                      label="Store"
                      value={draft.store}
                      required
                      onChange={(v) => set("store", v)}
                      error={blank(draft.store)}
                    />
                    <Field label="Store code" value={draft.storeCode} onChange={(v) => set("storeCode", v)} />
                    <Field
                      label="Date"
                      type="date"
                      value={draft.date}
                      required
                      onChange={(v) => set("date", v)}
                      error={blank(draft.date)}
                    />
                    <Field
                      label="Time"
                      type="time"
                      value={draft.time}
                      required
                      onChange={(v) => set("time", v)}
                      error={blank(draft.time)}
                    />
                  </div>
                  <h3>Totals as printed</h3>
                  <div className="grid">
                    <Field
                      label="Gross"
                      inputMode="decimal"
                      value={draft.printedGross}
                      required
                      onChange={(v) => set("printedGross", v)}
                      error={blank(draft.printedGross) ?? badNum(draft.printedGross)}
                    />
                    <Field
                      label="Discount"
                      inputMode="decimal"
                      value={draft.printedDiscount}
                      required
                      onChange={(v) => set("printedDiscount", v)}
                      error={blank(draft.printedDiscount) ?? badNum(draft.printedDiscount)}
                      hint="Enter 0 only if the receipt prints 0"
                    />
                    <Field
                      label="Net"
                      inputMode="decimal"
                      value={draft.printedNet}
                      required
                      onChange={(v) => set("printedNet", v)}
                      error={blank(draft.printedNet) ?? badNum(draft.printedNet)}
                    />
                  </div>
                  <h3>Loyalty (optional)</h3>
                  <div className="grid">
                    <Field
                      label="Points earned"
                      inputMode="decimal"
                      value={draft.pointsEarned}
                      onChange={(v) => set("pointsEarned", v)}
                    />
                    <Field
                      label="Points balance printed"
                      inputMode="decimal"
                      value={draft.pointsBalance}
                      onChange={(v) => set("pointsBalance", v)}
                    />
                    <Field
                      label="Loyalty scheme"
                      value={draft.loyaltyScheme}
                      onChange={(v) => set("loyaltyScheme", v)}
                    />
                  </div>
                  <h3>Payment</h3>
                  {draft.tenders.map((t, i) => (
                    <div key={i} className="grid" style={{ marginBottom: 8 }}>
                      <Field
                        label={`Method ${i + 1}`}
                        value={t.method}
                        required
                        onChange={(v) =>
                          set(
                            "tenders",
                            draft.tenders.map((x, j) => (j === i ? { ...x, method: v } : x)),
                          )
                        }
                      />
                      <Field
                        label={`Amount ${i + 1}`}
                        inputMode="decimal"
                        value={t.amount}
                        required
                        onChange={(v) =>
                          set(
                            "tenders",
                            draft.tenders.map((x, j) => (j === i ? { ...x, amount: v } : x)),
                          )
                        }
                        error={badNum(t.amount)}
                      />
                    </div>
                  ))}
                  <button
                    className="btn small"
                    onClick={() => set("tenders", [...draft.tenders, { method: "", amount: "" }])}
                  >
                    Add a payment line
                  </button>
                </section>

                <section className="card scroll" aria-labelledby="l-h">
                  <h2 id="l-h">
                    Lines <span className="muted small">— rate × qty − discount must equal amount</span>
                  </h2>
                  <table className="cards">
                    <thead>
                      <tr>
                        {[
                          "Ln",
                          "Code",
                          "Name",
                          "Rate",
                          "Qty",
                          "Discount",
                          "Amount",
                          "Scheme",
                          "Check",
                          "",
                        ].map((h, i) => (
                          <th key={i} scope="col">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.lines.map((l, i) => {
                        const st = lineStatus(l);
                        return (
                          <tr key={i} className={st.ok ? "" : "badrow"}>
                            {(
                              ["ln", "code", "name", "rate", "qty", "discount", "amount", "scheme"] as const
                            ).map((k) => (
                              <td
                                key={k}
                                data-label={k === "ln" ? "Line no." : k[0].toUpperCase() + k.slice(1)}
                              >
                                <input
                                  aria-label={`${k} on line ${i + 1}`}
                                  value={l[k]}
                                  inputMode={
                                    ["rate", "qty", "discount", "amount", "ln"].includes(k)
                                      ? "decimal"
                                      : undefined
                                  }
                                  aria-invalid={
                                    !st.ok && ["rate", "qty", "discount", "amount"].includes(k)
                                      ? true
                                      : undefined
                                  }
                                  onChange={(e) => setLine(i, k, e.target.value)}
                                />
                              </td>
                            ))}
                            <td data-label="Check">
                              {st.ok ? (
                                <span className="status-ok">✓ OK</span>
                              ) : (
                                <span className="status-bad">✕ Fix — {st.message}</span>
                              )}
                            </td>
                            <td data-label="">
                              <button
                                className="btn small"
                                aria-label={`Remove line ${i + 1}`}
                                onClick={() =>
                                  set(
                                    "lines",
                                    draft.lines.filter((_, j) => j !== i),
                                  )
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button
                    className="btn small"
                    style={{ marginTop: 8 }}
                    onClick={() => set("lines", [...draft.lines, blankLine(draft.lines.length + 1)])}
                  >
                    Add a line
                  </button>
                </section>

                <section className="card" aria-labelledby="c-h" aria-live="polite">
                  <h2 id="c-h">Reconciliation</h2>
                  {outcome.problems.length > 0 && (
                    <>
                      <p>
                        <strong>Fix these before the checks can run:</strong>
                      </p>
                      <ul>
                        {outcome.problems.map((p) => (
                          <li key={p} className="status-bad">
                            {p}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {outcome.checks.length > 0 && <CheckList checks={outcome.checks} />}
                  {result?.status === "duplicate" && (
                    <div className="banner info" role="status">
                      {result.ref} is already in the ledger — nothing was changed.
                    </div>
                  )}
                </section>

                <div className="savebar" role="region" aria-label="Save">
                  <span role="status">
                    {outcome.canSave ? (
                      <span className="status-ok">✓ All checks pass</span>
                    ) : (
                      <span className="status-bad">
                        ✕ Cannot save:{" "}
                        {outcome.problems.length
                          ? `${outcome.problems.length} problem${outcome.problems.length > 1 ? "s" : ""}`
                          : `${failing} check${failing === 1 ? "" : "s"} failing`}
                        {badLines ? ` · ${badLines} line${badLines > 1 ? "s" : ""} to fix` : ""}
                      </span>
                    )}
                  </span>
                  <span className="row">
                    <button className="btn" onClick={reset}>
                      Start over
                    </button>
                    <button className="btn primary" disabled={!outcome.canSave} onClick={save}>
                      Save to ledger
                    </button>
                  </span>
                </div>
                {!outcome.canSave && (
                  <p className="muted small">
                    Save stays disabled until every check passes. Correct the transcription against the photo
                    — never edit the printed totals to match.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function PhotoStrip({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  // object URLs are revoked by PhotoViewer's own copies; these thumbnails are short-lived
  return (
    <ul className="thumbs" style={{ listStyle: "none", padding: 0 }} aria-label="Selected photos">
      {files.map((f, i) => (
        <li className="thumb" key={`${f.name}-${i}`}>
          <img src={urls[i]} alt={`Page ${i + 1}: ${f.name}`} onLoad={() => URL.revokeObjectURL(urls[i])} />
          <button className="remove" aria-label={`Remove photo ${i + 1}`} onClick={() => onRemove(i)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
