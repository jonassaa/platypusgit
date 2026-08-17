/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  // The syntax tokenizer runs in a module worker (src/lib/syntax/tokenize.worker.ts)
  // and Shiki loads each grammar as a dynamic import, so the worker bundle is
  // code-split. Vite's default worker format is "iife", which rollup refuses for a
  // split build — the production build fails outright without this.
  worker: { format: "es" },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Two suites, because they need different worlds. The frontend suite is jsdom
  // and installs the Tauri mocks; the repo-level `test/` suite asserts facts
  // about the tree (CLAUDE.md vs src-tauri/, features/, e2e/) and touches only
  // node:fs — running it through the component harness makes it fail on jsdom
  // globals the setup file shims (`Range`), for no benefit.
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "docs",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
}));
