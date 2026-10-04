import { DEFAULT_MODEL } from "./domain/ocr";

// localStorage can throw (private windows, blocked storage); the app must still work.
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const loadSettings = () => ({
  apiKey: get("anthropic_api_key") ?? "",
  // Default is documented in README; override here or at build time with VITE_ANTHROPIC_MODEL.
  model: get("anthropic_model") || (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined) || DEFAULT_MODEL,
});
export const saveSettings = (s: { apiKey: string; model: string }) => {
  set("anthropic_api_key", s.apiKey.trim());
  set("anthropic_model", s.model.trim());
};
