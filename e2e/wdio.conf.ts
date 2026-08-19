import path from "node:path";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { $, browser } from "@wdio/globals";
import { armDriverBridge, ensureMacAppFocus } from "./support/app";
import { listSpecFiles, shardFromEnv, shardSpecs } from "./shardSpecs";

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

// One runner cannot run two app instances (an e2e-feature binary serves
// WebDriver on a fixed port), so `maxInstances` has to stay 1 and the suite is
// parallelised across CI RUNNERS instead: the workflow's matrix sets E2E_SHARD /
// E2E_SHARDS and each job runs its own slice (issue 189). With neither set —
// every local and Docker run — `specs` keeps the plain glob and the run is
// byte-for-byte what it was. See e2e/shardSpecs.ts for the split itself.
const shard = shardFromEnv(process.env);
const specs = shard
  ? shardSpecs(
      listSpecFiles(path.resolve(import.meta.dirname, "./specs")),
      shard.shard,
      shard.total,
    )
  : ["./specs/**/*.e2e.ts"];

if (shard) {
  // The one line that makes a shard failure reproducible: it names the exact
  // slice, so `--spec` can replay it locally.
  console.log(
    `[e2e] shard ${shard.shard}/${shard.total}: ${specs.length} spec(s)\n` +
      specs.map((s) => `  ${path.basename(s)}`).join("\n"),
  );
  if (specs.length === 0) {
    throw new Error(
      `shard ${shard.shard}/${shard.total} resolved to no specs — more shards ` +
        "than spec files, or e2e/specs/ is empty",
    );
  }
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs,
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
  // Leave the slate clean for the NEXT spec file in this job.
  //
  // A spec file gets a fresh app PROCESS but not a fresh app data dir, so
  // localStorage survives between spec files — and `pg-open-repos` makes the
  // next launch restore a repository instead of rendering Welcome, the screen
  // the `before` hook above and every `openRepo` wait for. Two specs leave that
  // key behind (`repo-tabs`, `open-persisted-screen`); today it never bites only
  // because they also dispose their temp repos, so the restore fails and Welcome
  // renders anyway. That is a property of two OTHER files, and sharding changes
  // which spec follows which — so clear it here and the guarantee is structural.
  //
  // Deliberately at the END, and deliberately with NO refresh. Doing it in
  // `before` instead cost ~30s per spec file and nearly DOUBLED the suite
  // (measured: 528s -> 1064s over run 32246987758): the extra `browser.refresh()`
  // re-rolled the reload race the conf documents above, and on Linux the W3C
  // script timeout is uncapped, so each loss is a full 30s stall. Clearing
  // after the last test needs no navigation, so it adds no refresh and no roll.
  after: async () => {
    try {
      await browser.execute(() => localStorage.clear());
    } catch {
      // Session already gone (crashed spec). The next launch inherits whatever
      // is on disk — exactly the pre-existing behaviour, so nothing to do.
    }
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
