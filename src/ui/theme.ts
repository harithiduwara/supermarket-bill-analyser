/** Light / dark / follow-the-system. The choice is a per-device convenience, so a blocked localStorage must never break the app. */
export type Theme = "system" | "light" | "dark";

const KEY = "theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function setTheme(t: Theme): void {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
  applyTheme(t);
}

export const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
export const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
