import path from "node:path";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { $, browser } from "@wdio/globals";
import { armDriverBridge, ensureMacAppFocus } from "./support/app";

// The app registers tauri-plugin-single-instance; a test binary starting
// while any platypusgit instance runs would forward-and-exit instead of
// serving WebDriver. The env var (checked in lib.rs run()) disables the
// plugin for children of this process.
process.env.PLATYPUSGIT_NO_SINGLE_INSTANCE = "1";

// Snapshot copied by `pnpm test:e2e` after building with
// `--features tauri/custom-protocol` (which embeds the frontend assets).
// We don't point at src-tauri/target/debug/ directly: any plain
// `cargo build` / `cargo test` (or editor tooling) rewrites that binary
// WITHOUT the custom-protocol feature, producing a dev-mode binary that
// expects a Vite dev server and renders a blank window.
const appBinaryPath = path.resolve(import.meta.dirname, "./.bin/platypusgit");

const tauriCapability: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: appBinaryPath,
  },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [tauriCapability],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
      },
    ],
  ],
  // Hand the freshly loaded page's Tauri core API to the driver before any
  // spec runs a find/click (see armDriverBridge for why).
  before: async () => {
    await armDriverBridge();
    // Kill the service's per-command focus check for the whole session. It
    // runs before EVERY find/click through the direct-eval channel, whose
    // script wrapper polls `window.__wdio_original_core__` for up to 5s when
    // the page is unarmed — the source of every "suite suddenly takes
    // minutes" flake (see armDriverBridge doc). An explicit switchWindow()
    // sets the service's session-wide "user switched windows" flag, which
    // makes ensureActiveWindowFocus return immediately from then on. This
    // app is single-window ("main" — Tauri's default label), so focus
    // management has nothing to manage anyway.
    await browser.tauri.switchWindow("main");
    // macOS only: cap the driver's W3C script timeout (default 30s). An
    // execute() fired while a refresh() navigation is mid-document-swap gets
    // its evaluateJavaScript completion handler silently dropped by
    // WKWebView; the driver then waits the FULL script timeout before
    // erroring and the caller retries. Locally every in-page script finishes
    // in milliseconds, so 2.5s only bounds that pathological hang: random
    // ~30s-per-spec stalls become a rare, invisible ~2.5s retry. Do NOT
    // apply on Linux CI: under xvfb, legitimate executes can exceed 2.5s,
    // and a timed-out-but-completed script gets retried — double-running
    // side-effectful helpers (observed: merge-conflict flow desync).
    if (process.platform === "darwin") {
      await browser.setTimeout({ script: 2500 });
    }
    // macOS only (no-op elsewhere): the unbundled debug binary doesn't
    // reliably win foreground focus at launch, and an unfocused/occluded
    // WKWebView reports the page hidden — isDisplayed() then returns false
    // for elements that ARE in the DOM and every waitForDisplayed dies with
    // "... never appeared" (issue #32). The service's own self-heal is a
    // silent no-op (its plugin lacks get_window_states, and guard 1 above
    // disables it regardless), so force activation ourselves and assert the
    // page actually reports visible+focused before any spec runs.
    await ensureMacAppFocus();
    // On a fresh session the webview may still be booting; openRepo() starts
    // with a browser.refresh(), which must not fire mid-boot. Wait for the
    // Welcome screen once here so every repo-opening spec is safe from the
    // very first test.
    await $("div*=Welcome to PlatypusGit").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "app never rendered Welcome screen",
    });
  },
  // Heal mid-suite focus steals (another app grabbing foreground between
  // tests): one cheap execute per test when already focused, setFocus retry
  // loop only when the page reports hidden/unfocused. macOS only — no-op on
  // Linux CI.
  beforeTest: async () => {
    await ensureMacAppFocus();
  },
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  // Silence @wdio/tauri-service WARN spam: its per-command focus check invokes
  // `plugin:wdio|get_window_states`, a command tauri-plugin-wdio-webdriver
  // 1.2.0 does not ship (checked: string absent from the crate source), so
  // any find/click that reaches it logs "Command not found" — that missing
  // command is also why the service's focus self-heal silently no-ops (issue
  // #32; ensureMacAppFocus fills the gap). The service pins its own
  // @wdio/logger@9.18.0 — a
  // separate module instance from the runner's — so a `logLevels`
  // per-scope entry never reaches it. What DOES reach it is WDIO_LOG_LEVEL,
  // seeded from `logLevel` before services load. So: default everything to
  // error, then restore warn for the runner-side scopes (same logger instance
  // as the runner, so `logLevels` works for these).
  logLevel: "error",
  logLevels: {
    webdriver: "warn",
    webdriverio: "warn",
    "@wdio/runner": "warn",
    "@wdio/utils": "warn",
    "@wdio/local-runner": "warn",
    "@wdio/cli": "warn",
  },
  reporters: ["spec"],
};
