import { useEffect, useRef } from "react";

const EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * Locks after `minutes` without interaction. Real activity (not mere mouse movement) counts, and coming back to a
 * tab that sat idle in the background locks it straight away instead of showing the ledger for a moment first.
 */
export function useIdleLock(enabled: boolean, minutes: number, onIdle: () => void, onActive?: () => void) {
  const last = useRef(Date.now());
  const lastReported = useRef(0);
  const idle = useRef(onIdle);
  const active = useRef(onActive);
  idle.current = onIdle;
  active.current = onActive;

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    const limit = minutes * 60_000;
    const check = () => {
      if (Date.now() - last.current >= limit) idle.current();
    };
    const touch = () => {
      const now = Date.now();
      if (now - last.current >= limit) return idle.current(); // woke up past the limit: lock, do not extend
      last.current = now;
      if (now - lastReported.current > 30_000) {
        lastReported.current = now;
        active.current?.(); // slide the stored expiry forward so a reload does not lose a live session
      }
    };
    const visible = () => document.visibilityState === "visible" && check();
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(check, 5_000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, touch);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
    };
  }, [enabled, minutes]);
}
