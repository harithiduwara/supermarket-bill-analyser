/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// GitHub Pages cannot send HTTP security headers, so the policy ships as a <meta> tag
// (see docs/threat-model.md). Build only: the dev server injects inline scripts for HMR.
// connect-src is the only network egress: the OCR provider. No third-party scripts exist.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://api.anthropic.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const securityMeta = (): Plugin => ({
  name: "security-meta",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
      injectTo: "head-prepend",
    },
    { tag: "meta", attrs: { name: "referrer", content: "no-referrer" }, injectTo: "head-prepend" },
  ],
});

// base "./" so the built site works from any GitHub Pages path without hard-coding the repo name.
export default defineConfig({
  base: "./",
  plugins: [react(), securityMeta()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { sourcemap: false, target: "es2022" },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/settings.ts"],
      reporter: ["text-summary", "lcov"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
});
