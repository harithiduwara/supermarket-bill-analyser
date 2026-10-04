import { useEffect, useRef, useState } from "react";
import { exportLedger, importLedger, type ImportSummary } from "../../domain/ingest";
import { RULES_VERSION } from "../../domain/rules";
import { settings } from "../../settings";
import { requestPersistence, storageStatus, type StorageStatus } from "../../storage";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context";
import { fmtDateTime } from "../format";

const mb = (n: number | null) => (n === null ? "unknown" : `${(n / 1024 / 1024).toFixed(1)} MB`);
const DOCS = "https://github.com/harithiduwara/supermarket-bill-analyser/tree/main/docs";

export function SettingsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const { store, bills, toast } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [lastExport, setLastExport] = useState(settings.getLastExport());
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importErr, setImportErr] = useState("");
  const [key, setKey] = useState(settings.getApiKey().key);
  const [remember, setRemember] = useState(settings.getApiKey().remembered);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(settings.getModel());

  useEffect(() => {
    void storageStatus().then(setStatus);
  }, []);

  async function doExport() {
    const file = await exportLedger(store);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `grocery-ledger-${file.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    settings.markExported();
    setLastExport(settings.getLastExport());
    toast(`Exported ${file.bills.length} bills.`);
  }

  async function doImport(f: File) {
    setSummary(null);
    setImportErr("");
    try {
      const s = await importLedger(store, await f.text());
      setSummary(s);
      await onChanged();
      toast(`Import finished: ${s.added} added.`);
    } catch (e) {
      setImportErr((e as Error).message);
    }
  }

  async function protect() {
    const ok = await requestPersistence();
    setStatus(await storageStatus());
    toast(
      ok
        ? "This browser will now protect the ledger from automatic clean-up."
        : "The browser declined. Keep regular exports instead.",
      ok ? "ok" : "bad",
    );
  }

  return (
    <>
      <PageHeader title="Settings & backup" lead="Everything lives on this device. Back it up." />

      <section className="card" aria-labelledby="bk">
        <h2 id="bk">Backup</h2>
        <p>
          {bills.length} bills in this browser.{" "}
          {lastExport ? (
            <>
              Last exported <strong>{fmtDateTime(lastExport.toISOString())}</strong>.
            </>
          ) : (
            <strong>Never exported.</strong>
          )}{" "}
          Clearing site data deletes the ledger, and it does not follow you to another device. Receipt photos
          are not part of the export.
        </p>
        <div className="row">
          <button className="btn primary" onClick={doExport} disabled={bills.length === 0}>
            Export ledger (JSON)
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import ledger…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Choose a ledger file to import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Import is safe to repeat. The file is validated, every bill is re-checked, bills already present are
          skipped, and any that fail a check are rejected by name.
        </p>
        {importErr && (
          <div className="banner bad" role="alert">
            Import failed: {importErr}. Nothing was changed.
          </div>
        )}
        {summary && (
          <div
            className={`banner ${summary.rejected.length || summary.invalid.length ? "warn" : "ok"}`}
            role="status"
          >
            <strong>{summary.added} added</strong>, {summary.duplicate} already present,{" "}
            {summary.rejected.length} failed checks, {summary.invalid.length} invalid.
            {summary.rejected.map((r) => (
              <div key={r.ref} className="small">
                Rejected {r.ref}: {r.failing.join("; ")}
              </div>
            ))}
            {summary.invalid.map((r) => (
              <div key={r.index} className="small">
                Invalid bill #{r.index + 1}
                {r.ref ? ` (${r.ref})` : ""}: {r.reason}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="st">
        <h2 id="st">Storage protection</h2>
        {status === null ? (
          <p>Checking…</p>
        ) : !status.supported ? (
          <p className="muted">This browser does not report storage status. Rely on exports.</p>
        ) : (
          <>
            <p>
              {status.persisted ? (
                <span className="badge ok">✓ Protected</span>
              ) : (
                <span className="badge warn">! Not protected</span>
              )}{" "}
              {status.persisted
                ? "The browser will not clear this ledger automatically."
                : "Under storage pressure the browser may clear this ledger without asking."}{" "}
              Using {mb(status.usageBytes)} of {mb(status.quotaBytes)}.
            </p>
            {!status.persisted && (
              <button className="btn" onClick={protect}>
                Ask the browser to protect it
              </button>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="ocr">
        <h2 id="ocr">Photo reading (Anthropic API)</h2>
        <p className="small">
          Receipt photos are sent from this page straight to Anthropic, only when you press “Read”. The key is
          kept for this browser tab and forgotten when you close it, unless you choose to remember it. Use a
          key with a spend limit, and never on a shared computer.
        </p>
        <div className="grid">
          <Field
            label="API key"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={setKey}
            placeholder="sk-ant-…"
          />
          <Field
            label="Model"
            value={model}
            onChange={setModel}
            hint="Check the current model list in the Anthropic docs."
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="row small">
            <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show
            key
          </label>
          <label className="row small">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{" "}
            Remember on this device (less safe)
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            onClick={() => {
              settings.setApiKey(key, remember);
              settings.setModel(model);
              toast("Settings saved.");
            }}
          >
            Save
          </button>
          <button
            className="btn"
            onClick={() => {
              settings.clearApiKey();
              setKey("");
              setRemember(false);
              toast("API key removed from this browser.");
            }}
          >
            Remove key
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="ab">
        <h2 id="ab">About</h2>
        <p className="small">
          Version {__APP_VERSION__} · rules v{RULES_VERSION}. Figures are exactly as printed on the bills;
          categories and schemes are inferred and say so wherever they appear.{" "}
          <a href={DOCS} target="_blank" rel="noreferrer">
            Requirements, decisions and threat model
          </a>
          .
        </p>
      </section>
    </>
  );
}
