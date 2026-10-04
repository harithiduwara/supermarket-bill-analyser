import { useCallback, useRef, useState, type ReactNode } from "react";
import { AppContext, type ToastKind } from "../context";
import type { AppCtx } from "../context";

interface T {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Successes are announced politely and expire; errors are assertive and stay until dismissed. */
export function useToasts() {
  const [toasts, setToasts] = useState<T[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<AppCtx["toast"]>(
    (message, kind = "ok") => {
      const id = next.current++;
      setToasts((t) => [...t, { id, message, kind }]);
      if (kind === "ok") window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  const view: ReactNode = (
    <div className="toasts">
      <div role="status" aria-live="polite">
        {toasts
          .filter((t) => t.kind === "ok")
          .map((t) => (
            <Toast key={t.id} t={t} onClose={dismiss} />
          ))}
      </div>
      <div role="alert">
        {toasts
          .filter((t) => t.kind === "bad")
          .map((t) => (
            <Toast key={t.id} t={t} onClose={dismiss} />
          ))}
      </div>
    </div>
  );
  return { toast, view };
}

function Toast({ t, onClose }: { t: T; onClose: (id: number) => void }) {
  return (
    <div className={`toast ${t.kind}`}>
      <span>{t.message}</span>
      <button className="btn small" onClick={() => onClose(t.id)} aria-label="Dismiss notification">
        ✕
      </button>
    </div>
  );
}

export { AppContext };
