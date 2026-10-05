import { useCallback, useEffect, useRef, useState } from "react";
import { describeImport, importLedger, type ImportSummary } from "../../domain/ingest";
import {
  billsNotInAnyWorkbook,
  exportWorkbook,
  importWorkbook,
  WorkbookError,
  type WorkbookImportSummary,
} from "../../export/workbookIO";
import { loadDemo } from "../../domain/seed";
import { settings } from "../../settings";
import { PageHeader } from "../components/PageHeader";
import { DemoBanner } from "../components/DemoBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useApp } from "../context";
import { fmtDateTime } from "../format";
import { href } from "../router";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Report {
  file: string;
  /** set for workbooks; JSON backups carry no metadata */
  workbook?: WorkbookImportSummary;
  summary?: ImportSummary;
  error?: string;
}

export function WorkbookPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const { store, bills, toast } = useApp();
  const [pending, setPending] = useState<string[] | null>(null);
  const [lastExport, setLastExport] = useState(settings.getLastExport());
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refreshStatus = useCallback(async () => setPending(await billsNotInAnyWorkbook(store)), [store]);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, bills]);

  async function doImport(files: File[]) {
    const out: Report[] = [];
    setBusy("import");
    setReports([]);
    try {
      for (const f of files) {
        try {
          const name = f.name.toLowerCase();
          if (name.endsWith(".xlsm") || name.endsWith(".xls") || name.endsWith(".xlsb")) {
            throw new WorkbookError(
              "only .xlsx workbooks exported by this app can be imported (macro-enabled and legacy Excel files are refused)",
            );
          }
          if (name.endsWith(".json"))
            out.push({ file: f.name, summary: await importLedger(store, await f.text()) });
          else if (name.endsWith(".xlsx"))
            out.push({ file: f.name, workbook: await importWorkbook(store, await f.arrayBuffer()) });
          else throw new WorkbookError("choose an .xlsx workbook exported by this app (or a .json backup)");
        } catch (e) {
          out.push({ file: f.name, error: (e as Error).message });
        }
        setReports([...out]);
      }
      await onChanged();
      await refreshStatus();
      const added = out.reduce((n, r) => n + ((r.workbook ?? r.summary)?.added ?? 0), 0);
      toast(
        out.some((r) => r.error)
          ? "Import finished with problems — see below."
          : `Import finished: ${added} bill${added === 1 ? "" : "s"} added.`,
        out.some((r) => r.error) ? "bad" : "ok",
      );
    } finally {
      setBusy(null);
    }
  }

  async function doExport() {
    setBusy("export");
    try {
      const { data, filename, bills: n } = await exportWorkbook(store, { appVersion: __APP_VERSION__ });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: XLSX_MIME }));
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      settings.markExported();
      setLastExport(settings.getLastExport());
      await refreshStatus();
      toast(`Downloaded ${filename} (${n} bills). Keep it — import it next time.`);
    } catch (e) {
      toast(`Could not build the workbook: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(null);
    }
  }

  const mine = bills.filter((b) => !b.demo).length; // demo bills are never exported
  const upToDate = pending !== null && pending.length === 0;

  return (
    <>
      <PageHeader
        title="Workbook"
        lead="Your Excel workbook is your ledger. Import last time's workbook, add new bills, then export it again — and repeat."
      />

      <DemoBanner onRemoved={onChanged} />
      {bills.length === 0 && (
        <section className="card" aria-labelledby="fr-h">
          <h2 id="fr-h">Nothing here yet</h2>
          <p>
            Your ledger is empty and lives only in this browser. Import a workbook you exported before (step
            1), add bills (step 2), or look around first with invented bills:
          </p>
          <button
            className="btn"
            onClick={async () => {
              await loadDemo(store);
              await onChanged();
              toast("Demo data loaded — these bills are invented.");
            }}
          >
            Load demo data
          </button>
        </section>
      )}

      <section className="card" aria-labelledby="st-h">
        <h2 id="st-h">Where things stand</h2>
        <dl className="facts">
          <div>
            <dt>Bills in the ledger</dt>
            <dd>{bills.length}</dd>
          </div>
          <div>
            <dt>Not yet in a workbook you hold</dt>
            <dd>{pending === null ? "…" : pending.length}</dd>
          </div>
          <div>
            <dt>Last workbook exported</dt>
            <dd>{lastExport ? fmtDateTime(lastExport.toISOString()) : "never"}</dd>
          </div>
        </dl>
        <p style={{ marginTop: 10 }} role="status">
          {pending === null ? null : upToDate ? (
            <StatusBadge ok okText="Your workbook is up to date" />
          ) : (
            <span className="badge warn wrap">
              ! {pending.length} bill{pending.length === 1 ? "" : "s"} {pending.length === 1 ? "is" : "are"}{" "}
              not in any workbook you hold — export again
            </span>
          )}
        </p>
      </section>

      <div className="steps">
        <section className="card step" aria-labelledby="w1">
          <h2 id="w1">Import your last workbook</h2>
          <p className="small muted">
            Start here if you have one. Every bill in it is re-checked, bills already here are skipped, and
            nothing is ever overwritten. You can choose several files. First time? Skip to step 2.
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
              void doImport([...e.dataTransfer.files]);
            }}
          >
            <strong>{busy === "import" ? "Importing…" : "Choose your workbook (.xlsx)"}</strong>
            <div className="muted small">or drop it here</div>
            <input
              ref={input}
              type="file"
              multiple
              accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy !== null}
              onChange={(e) => {
                if (e.target.files?.length) void doImport([...e.target.files]);
                e.target.value = "";
              }}
            />
          </label>
          <div aria-live="polite">
            {reports.map((r) => (
              <ImportReport key={r.file} r={r} />
            ))}
          </div>
        </section>

        <section className="card step" aria-labelledby="w2">
          <h2 id="w2">Add your new bills</h2>
          <p className="small muted">Each bill is checked line by line and must add up before it is saved.</p>
          <div className="row">
            <a className="btn primary" href={href.receipt}>
              Add a photo receipt
            </a>
            <a className="btn" href={href.ebill}>
              Add a Keells e-bill
            </a>
            <a className="btn" href={href.ledger}>
              See the ledger
            </a>
          </div>
        </section>

        <section className="card step" aria-labelledby="w3">
          <h2 id="w3">Export your workbook</h2>
          <p className="small muted">
            One Excel file with Summary, Bills, Line Items and Monthly Trend, plus the data this app reads
            back next time. Keells totals are marked as a floor. Keep the file — it is your ledger.
          </p>
          <button className="btn primary" disabled={busy !== null || mine === 0} onClick={doExport}>
            {busy === "export" ? "Building…" : "Download workbook (.xlsx)"}
          </button>
          {mine === 0 && (
            <span className="muted small hint-block">
              There is nothing of yours to export yet. Demo bills are never included.
            </span>
          )}
          {!upToDate && pending !== null && mine > 0 && (
            <span className="muted small hint-block">
              The file will include the {pending.length} bill{pending.length === 1 ? "" : "s"} not yet in a
              workbook.
            </span>
          )}
        </section>
      </div>

      <p className="muted small">
        Next time: open this page, import the workbook you just downloaded, add that day's bills, and export
        again. Do not edit the Data_ sheets inside it; everything else in the file you can format, chart or
        extend freely.
      </p>
    </>
  );
}

function ImportReport({ r }: { r: Report }) {
  if (r.error) {
    return (
      <div className="banner bad" role="alert" style={{ marginTop: 12 }}>
        <strong>{r.file} was not imported.</strong> {r.error}. Nothing was changed.
      </div>
    );
  }
  const s = (r.workbook ?? r.summary) as ImportSummary;
  const problems = s.rejected.length + s.invalid.length + s.conflicts.length > 0;
  const w = r.workbook;
  return (
    <div
      className={`banner ${problems || w?.checksum === "mismatch" ? "warn" : "ok"}`}
      role="status"
      style={{ marginTop: 12 }}
    >
      <strong>{r.file}</strong>: {describeImport(s)}.
      {w && (
        <div className="small">
          Exported {w.meta.exportedAt ? fmtDateTime(w.meta.exportedAt) : "at an unknown time"}
          {w.meta.appVersion ? ` by app v${w.meta.appVersion}` : ""} · {w.billsInFile} bills in the file
          {w.checksum === "match" && " · ✓ contents unchanged since export"}
          {w.checksum === "mismatch" &&
            " · ! contents differ from what was exported — the file was edited outside the app, or some bills could not be read"}
          {w.notInFile > 0 &&
            ` · the ledger has ${w.notInFile} bill${w.notInFile === 1 ? "" : "s"} this file does not contain, so it is out of date`}
        </div>
      )}
      {s.conflicts.length > 0 && (
        <div className="small">
          <strong>Kept the ledger's version</strong> of {s.conflicts.join(", ")}: the file's copy differs.
          Importing never overwrites a bill.
        </div>
      )}
      {s.rejected.map((x) => (
        <div key={x.ref} className="small">
          Rejected {x.ref}: {x.failing.join("; ")}
        </div>
      ))}
      {s.invalid.map((x) => (
        <div key={`${x.index}-${x.reason}`} className="small">
          Could not read {x.ref ? x.ref : `item ${x.index + 1}`}: {x.reason}
        </div>
      ))}
    </div>
  );
}
