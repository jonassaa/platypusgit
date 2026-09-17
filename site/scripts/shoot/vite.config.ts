// Serves the real app (src/) to a browser with the Tauri surface faked, so
// headless Chrome can render a figure for the site. See
// docs/superpowers/specs/2026-09-17-screenshot-rig-design.md.
//
// This is a SEPARATE config from the repo root's on purpose: the root one is
// what `tauri dev` and the production bundle use, and aliasing @tauri-apps
// there would ship the fake.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const here = import.meta.dirname;
// site/scripts/shoot -> repo root
const root = path.resolve(here, "..", "..", "..");
const shim = path.resolve(here, "shim", "core.ts");

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // All eight point at one file — its export names do not collide, and the
      // header of shim/core.ts lists which module contributes what.
      "@tauri-apps/api/core": shim,
      "@tauri-apps/api/event": shim,
      "@tauri-apps/api/window": shim,
      "@tauri-apps/api/webviewWindow": shim,
      "@tauri-apps/api/webview": shim,
      "@tauri-apps/api/dpi": shim,
      "@tauri-apps/plugin-log": shim,
      "@tauri-apps/plugin-dialog": shim,
      "@tauri-apps/plugin-os": shim,
    },
  },
  // Copied from the root config deliberately: the syntax tokenizer runs in a
  // module worker and Shiki code-splits its grammars, which the bundler refuses
  // under the default "iife" worker format.
  worker: { format: "es" },
  server: { port: 1430, strictPort: true },
});
