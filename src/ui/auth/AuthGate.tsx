import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { passwordProblem, strength } from "../../vault/policy";
import { deleteLegacy, legacyCount, moveLegacyInto } from "../../vault/legacy";
import { Vault, VaultError, type Session } from "../../vault/vault";
import { Icon } from "../components/Icon";
import { Field } from "../components/Field";
import { ThemeToggle } from "../components/ThemeToggle";
import { useIdleLock } from "./useIdleLock";

export interface Unlocked {
  session: Session;
  vault: Vault;
  lock: () => void;
  autolock: number;
  setAutolock: (minutes: number) => Promise<void>;
}

type Mode = "signin" | "register" | "recover";
type Phase = "loading" | "locked" | "key" | "unlocked";

/** Everything behind this gate runs only while a profile is unlocked. Nothing renders, or reads the ledger, before. */
export function AuthGate({ children }: { children: (u: Unlocked) => ReactNode }) {
  const vault = useMemo(() => new Vault(), []);
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<Session>();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [hasProfiles, setHasProfiles] = useState(false);
  const [legacy, setLegacy] = useState(0);
  const sessionRef = useRef<Session>();
  sessionRef.current = session;

  const refreshFacts = useCallback(async () => {
    setHasProfiles(await vault.hasProfiles());
    setLegacy(await legacyCount());
    setMinutes(await vault.autolockMinutes());
  }, [vault]);

  useEffect(() => {
    void (async () => {
      await refreshFacts();
      const resumed = await vault.resume();
      if (resumed) {
        setSession(resumed);
        setPhase("unlocked");
      } else setPhase("locked");
    })();
  }, [vault, refreshFacts]);

  const lock = useCallback(
    (why = "") => {
      void (async () => {
        await vault.lock(sessionRef.current);
        await refreshFacts(); // know whether a profile exists BEFORE the sign-in screen first renders
        setSession(undefined);
        setNote(why);
        setPhase("locked");
      })();
    },
    [vault, refreshFacts],
  );

  useIdleLock(
    phase === "unlocked",
    minutes,
    () => lock("Locked after a period of inactivity."),
    () => session && void vault.remember(session, minutes),
  );

  async function enter(s: Session) {
    await vault.remember(s, minutes);
    setSession(s);
    setNote("");
    setPhase("unlocked");
  }

  if (phase === "loading" || (phase !== "locked" && !session))
    return (
      <div className="auth">
        <div role="status" className="auth-card">
          <p className="muted">Opening…</p>
        </div>
      </div>
    );
  if (phase === "unlocked" && session)
    return (
      <>
        {children({
          session,
          vault,
          lock: () => lock("You locked this profile."),
          autolock: minutes,
          setAutolock: async (m: number) => {
            await vault.setAutolockMinutes(m);
            setMinutes(m);
            await vault.remember(session, m);
          },
        })}
      </>
    );
  if (phase === "key" && session)
    return <RecoveryStep recoveryKey={recoveryKey} note={note} onDone={() => void enter(session)} />;

  return (
    <AuthScreen
      vault={vault}
      hasProfiles={hasProfiles}
      legacy={legacy}
      notice={note}
      onSignedIn={(s) => void enter(s)}
      onNewKey={(s, key, n) => {
        setSession(s);
        setRecoveryKey(key);
        setNote(n);
        setPhase("key");
      }}
    />
  );
}

function AuthScreen({
  vault,
  hasProfiles,
  legacy,
  notice,
  onSignedIn,
  onNewKey,
}: {
  vault: Vault;
  hasProfiles: boolean;
  legacy: number;
  notice: string;
  onSignedIn: (s: Session) => void;
  onNewKey: (s: Session, key: string, note: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(hasProfiles ? "signin" : "register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fails = useRef(0);
  const [wait, setWait] = useState(0);

  // after three wrong tries, make guessing through this form slower. (The real defence is the key derivation cost.)
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  function go(m: Mode) {
    setMode(m);
    setError("");
    setPassword("");
    setConfirm("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if ((mode === "register" || mode === "recover") && password !== confirm) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        onSignedIn(await vault.signIn(email, password));
      } else if (mode === "register") {
        const { session, recoveryKey } = await vault.register(email, password);
        let n = "";
        if (migrate && legacy > 0) {
          try {
            const { moved } = await moveLegacyInto(session.store);
            await deleteLegacy();
            n = `${moved} bills that were stored unencrypted in this browser are now inside your profile, and the unencrypted copy is deleted.`;
          } catch (err) {
            n = `Your profile was created, but moving the older bills failed (${(err as Error).message}). They are untouched; you can try again in Settings.`;
          }
        }
        onNewKey(session, recoveryKey, n);
      } else {
        const r = await vault.recover(email, recovery, password);
        onNewKey(
          r.session,
          r.recoveryKey,
          "Your password was reset. This is your new recovery key: the old one no longer works.",
        );
      }
    } catch (err) {
      if (err instanceof VaultError) setError(err.message);
      else {
        setError((err as Error).message);
        fails.current += 1;
        if (fails.current >= 3) setWait(Math.min(2 ** (fails.current - 3), 30));
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin" ? "Sign in" : mode === "register" ? "Create your profile" : "Reset your password";
  const strong = mode === "signin" ? undefined : strength(password);
  const policy = mode !== "signin" && password ? passwordProblem(password, email) : undefined;
  const mismatch =
    mode !== "signin" && confirm && password !== confirm ? "The two passwords are not the same." : undefined;

  return (
    <div className="auth">
      <div className="auth-top">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo" aria-hidden="true">
            <Icon name="receipt" size={18} />
          </span>
          Grocery ledger
        </div>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {notice && (
          <p className="banner info" role="status">
            {notice}
          </p>
        )}
        {mode === "register" && (
          <p className="muted small">
            Your bills are encrypted on this device with a key made from your password. There is no server and
            no email is sent.{" "}
            <strong>
              If you lose both your password and your recovery key, nobody can recover your bills
            </strong>{" "}
            — so keep an exported workbook too.
          </p>
        )}
        {mode === "recover" && (
          <p className="muted small">
            Enter the recovery key you saved when you created this profile, then choose a new password.
          </p>
        )}
        <form onSubmit={submit} noValidate>
          <div className="stack">
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
              required
              hint={
                mode === "register"
                  ? "Used only as your sign-in name on this device. It is not verified or sent anywhere."
                  : undefined
              }
            />
            {mode === "recover" && (
              <Field
                label="Recovery key"
                autoComplete="off"
                spellCheck={false}
                value={recovery}
                onChange={setRecovery}
                required
                hint="32 letters and digits, in groups of four."
              />
            )}
            <Field
              label={mode === "recover" ? "New password" : "Password"}
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={setPassword}
              required
              error={policy}
              hint={
                strong && !policy
                  ? `Strength: ${strong}. ${strong === "strong" ? "" : "A longer passphrase is better."}`
                  : undefined
              }
            />
            {mode !== "signin" && (
              <Field
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
                required
                error={mismatch}
              />
            )}
            {mode === "register" && legacy > 0 && (
              <label className="check">
                <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
                <span>
                  Move the <strong>{legacy}</strong> bills already stored unencrypted in this browser into
                  this profile (encrypts them, then deletes the unencrypted copy).
                </span>
              </label>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary block" type="submit" disabled={busy || wait > 0}>
            {busy
              ? "Working…"
              : wait > 0
                ? `Try again in ${wait}s`
                : mode === "signin"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create profile"
                    : "Reset password"}
          </button>
        </form>
        <div className="auth-links">
          {mode !== "signin" && (
            <button className="linklike" type="button" onClick={() => go("signin")}>
              {hasProfiles || mode === "recover" ? "Back to sign in" : "I already have a profile"}
            </button>
          )}
          {mode === "signin" && (
            <>
              <button className="linklike" type="button" onClick={() => go("register")}>
                Create a profile
              </button>
              <button className="linklike" type="button" onClick={() => go("recover")}>
                Forgot your password?
              </button>
            </>
          )}
        </div>
        <p className="side-note auth-foot">
          <Icon name="lock" size={14} /> Encrypted on this device. Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}

/** Shown once, right after a recovery key is made. Continuing requires saying it was saved. */
function RecoveryStep({
  recoveryKey,
  note,
  onDone,
}: {
  recoveryKey: string;
  note: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  function download() {
    const blob = new Blob(
      [
        `Grocery ledger — recovery key\n\n${recoveryKey}\n\nKeep this somewhere safe and private. It is the only way back in if you forget your password.\n`,
      ],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grocery-ledger-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="auth">
      <div className="auth-card">
        <h1 id="page-title" tabIndex={-1}>
          Save your recovery key
        </h1>
        {note && (
          <p className="banner info" role="status">
            {note}
          </p>
        )}
        <p>
          If you forget your password, this key is the <strong>only</strong> way to open your bills. It is
          shown once and is not stored anywhere readable.
        </p>
        <p className="recovery" aria-label="Your recovery key">
          {recoveryKey}
        </p>
        <div className="row">
          <button
            className="btn"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryKey).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn" type="button" onClick={download}>
            Download as a file
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I have saved my recovery key somewhere safe.</span>
        </label>
        <button className="btn primary block" type="button" disabled={!saved} onClick={onDone}>
          Continue
        </button>
      </div>
    </div>
  );
}
