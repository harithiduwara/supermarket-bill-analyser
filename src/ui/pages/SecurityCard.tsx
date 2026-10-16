import { useEffect, useState, type FormEvent } from "react";
import { deleteLegacy, legacyCount, moveLegacyInto } from "../../vault/legacy";
import { AUTOLOCK_CHOICES, VaultError } from "../../vault/vault";
import { Field } from "../components/Field";
import { useApp } from "../context";

/** One thing at a time, each needing the current password where it changes how the data is protected. */
export function SecurityCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const { session, vault, lock, autolock, setAutolock, store, toast } = useApp();
  const [panel, setPanel] = useState<"" | "password" | "key" | "delete">("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [legacy, setLegacy] = useState(0);
  const [confirmLegacy, setConfirmLegacy] = useState(false);

  useEffect(() => {
    void legacyCount().then(setLegacy);
  }, []);

  function open(p: typeof panel) {
    setPanel(p === panel ? "" : p);
    setCurrent("");
    setNext("");
    setAgain("");
    setTyped("");
    setErr("");
    setNewKey("");
  }

  async function run(e: FormEvent, job: () => Promise<void>) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await job();
    } catch (x) {
      setErr(
        x instanceof VaultError
          ? x.message
          : x instanceof Error && x.name === "WrongSecretError"
            ? "That password is not right."
            : (x as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="sec">
      <h2 id="sec">Profile &amp; security</h2>
      <p>
        Signed in as <strong>{session.email}</strong>. Your bills are encrypted on this device; the key is
        made from your password and never leaves the browser. Exported workbooks and JSON backups are{" "}
        <strong>not</strong> encrypted — keep them somewhere private.
      </p>
      <div className="grid" style={{ maxWidth: 420 }}>
        <div>
          <label className="field-label" htmlFor="autolock">
            Lock automatically after
          </label>
          <select
            id="autolock"
            value={autolock}
            onChange={(e) => {
              void setAutolock(Number(e.target.value));
              toast(`Auto-lock set to ${e.target.value} minutes.`);
            }}
          >
            {AUTOLOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} minutes without activity
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={lock}>
          Lock now
        </button>
        <button className="btn" aria-expanded={panel === "password"} onClick={() => open("password")}>
          Change password
        </button>
        <button className="btn" aria-expanded={panel === "key"} onClick={() => open("key")}>
          New recovery key
        </button>
        <button className="btn" aria-expanded={panel === "delete"} onClick={() => open("delete")}>
          Delete this profile
        </button>
      </div>

      {panel === "password" && !newKey && (
        <form
          className="stack panel"
          onSubmit={(e) =>
            run(e, async () => {
              if (next !== again) throw new VaultError("The two new passwords are not the same.");
              const r = await vault.changePassword(session, current, next);
              setNewKey(r.recoveryKey);
              toast("Password changed.");
            })
          }
        >
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            required
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            required
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={setAgain}
            required
          />
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Working…" : "Change password"}
            </button>
          </div>
        </form>
      )}
      {panel === "key" && !newKey && (
        <form
          className="stack panel"
          onSubmit={(e) =>
            run(e, async () => {
              setNewKey(await vault.newRecoveryKey(session, current));
            })
          }
        >
          <p className="small muted">The old recovery key stops working as soon as you make a new one.</p>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            required
          />
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Working…" : "Make a new recovery key"}
            </button>
          </div>
        </form>
      )}
      {newKey && (
        <div className="panel" role="status">
          <p>
            <strong>Your new recovery key.</strong> Save it now — it is shown once, and the previous one no
            longer works.
          </p>
          <p className="recovery" aria-label="Your new recovery key">
            {newKey}
          </p>
          <button className="btn" onClick={() => open("")}>
            I have saved it
          </button>
        </div>
      )}
      {panel === "delete" && (
        <form
          className="stack panel"
          onSubmit={(e) =>
            run(e, async () => {
              if (typed.trim().toLowerCase() !== session.email)
                throw new VaultError("Type your email exactly to confirm.");
              await vault.remove(session, current);
              lock();
            })
          }
        >
          <p className="banner bad">
            This permanently deletes every bill, photo and activity record in this profile from this device.
            Export a workbook first if you want to keep them.
          </p>
          <Field
            label="Type your email to confirm"
            value={typed}
            onChange={setTyped}
            autoComplete="off"
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            required
          />
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <div>
            <button className="btn" disabled={busy}>
              {busy ? "Working…" : "Delete this profile"}
            </button>
          </div>
        </form>
      )}

      {legacy > 0 && (
        <div className="banner warn" style={{ marginTop: 16 }}>
          <strong>{legacy} bills are stored unencrypted in this browser</strong> from before profiles existed.
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn small"
              onClick={async () => {
                try {
                  const { moved } = await moveLegacyInto(store);
                  await deleteLegacy();
                  setLegacy(0);
                  await onChanged();
                  toast(`Moved ${moved} bills into this profile and deleted the unencrypted copy.`);
                } catch (x) {
                  toast((x as Error).message, "bad");
                }
              }}
            >
              Move them into this profile
            </button>
            <button
              className="btn small"
              onClick={async () => {
                if (!confirmLegacy) return setConfirmLegacy(true);
                await deleteLegacy();
                setLegacy(0);
                toast("Deleted the unencrypted copy.");
              }}
            >
              {confirmLegacy ? "Really delete them?" : "Delete them"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
