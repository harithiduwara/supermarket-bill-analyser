/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from any GitHub Pages path
// (user.github.io/<repo>/) without hard-coding the repository name.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
