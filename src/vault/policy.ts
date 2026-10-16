/** Password rules. Length matters most; the KDF cost does the rest. No composition tricks. */
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 256;

const COMMON = new Set([
  "password12",
  "password123",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "qwerty12345",
  "iloveyou123",
  "letmein1234",
  "welcome1234",
  "admin12345",
]);

export function passwordProblem(password: string, email: string): string | undefined {
  if (password.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters. A few random words work well.`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  const p = password.toLowerCase();
  if (COMMON.has(p) || /^(.)\1+$/.test(p)) return "That password is too easy to guess.";
  const e = email.trim().toLowerCase();
  if (e && (p === e || p === e.split("@")[0])) return "Do not use your email as your password.";
  return undefined;
}

export type Strength = "weak" | "fair" | "strong";
/** A rough guide, not a guarantee: length first, then variety. */
export function strength(password: string): Strength {
  if (password.length < MIN_PASSWORD) return "weak";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length >= 16 || (password.length >= 12 && classes >= 3)) return "strong";
  return "fair";
}
