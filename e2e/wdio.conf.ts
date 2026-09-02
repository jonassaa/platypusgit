import { appendFileSync } from "node:fs";
import path from "node:path";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { $, browser } from "@wdio/globals";
import {
  armDriverBridge,
  ensureMacAppFocus,
  installStaleProofWaits,
} from "./support/app";
import {
  formatScriptTiming,
  recordScriptDuration,
  resolveScriptTimeoutMs,
} from "./support/scriptTiming";
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

// The script-timeout cap and the knob for re-measuring it (see the setTimeout
// call in `before`), read once here so the values a run used sit in one place.
// The resolver lives in support/ and is unit-tested: an empty-string override —
// what compose forwards for an unset host var — resolves to a ZERO timeout
// under the obvious spelling, and that fails every driver command instantly.
const scriptTimeoutMs = resolveScriptTimeoutMs(process.env, process.platform);
const scriptTimingVerbose = process.env.E2E_SCRIPT_TIMING === "1";

// Stall accounting (issue #194). `executeScript` is the command that can be
// dropped mid-document-swap and then costs the whole cap, so it is the one
// worth timing; the pair of hooks below is the only place the runner can see
// a command's real wall time. maxInstances is 1 and commands are awaited, so a
// single start timestamp is unambiguous.
const SCRIPT_COMMANDS = new Set(["executeScript", "executeAsyncScript"]);
let scriptStartedAt = 0;

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
    // Cap the driver's W3C script timeout (default 30s) — on EVERY platform
    // since issue #194. An execute() fired while a refresh() navigation is
    // mid-document-swap gets its completion handler silently dropped; the
    // driver then waits the FULL script timeout before erroring and the caller
    // retries. The cap is what that pathological hang costs.
    //
    // `refreshAndSettle` (e2e/support/app.ts) is the actual fix — it removes
    // the mid-swap execute, and with it the roll of the die. This is the belt:
    // any refresh site that ever slips past the rule pays the cap, not 30s.
    //
    // Why Linux gets a cap now, when the comment here used to refuse one. The
    // refusal was correct at the time: a script that times out but still RAN
    // gets retried, which double-runs side-effectful helpers (that is the
    // merge-conflict desync, issue #35). `executeOnce` closed that hole
    // afterwards — it mints a token per logical call and the page skips
    // already-run tokens, so a retry is a no-op that returns the first run's
    // value. Every side-effectful script in e2e/ goes through it (the
    // remaining bare-execute writes — localStorage seeds, scrollTop, a
    // Selection, window.close — are idempotent by construction), and
    // harness.e2e.ts replays a script with its own token to prove the guard.
    //
    // The values differ because the platforms do. macOS keeps 2.5s: WKWebView
    // in-page scripts finish in single-digit milliseconds there. Linux/xvfb is
    // slower and shares a CI runner, so it gets a wider cap — measured, not
    // guessed. With the mid-swap executes gone, no legitimate script comes
    // close: max 12ms across the suite in local Docker, max 190ms on a real CI
    // runner (run 32877754926, all 28 specs, slowest single script anywhere).
    // E2E_SCRIPT_TIMING=1 prints the spread per spec. So 8s leaves ~40x
    // headroom over the worst observed CI script and is still ~4x cheaper than
    // the default when something does hang.
    // E2E_SCRIPT_TIMEOUT_MS=30000 restores the driver default to measure
    // against; the value is resolved by resolveScriptTimeoutMs (see there —
    // the empty-string case is not academic).
    await browser.setTimeout({ script: scriptTimeoutMs });
    // macOS only (no-op elsewhere): the unbundled debug binary doesn't
    // reliably win foreground focus at launch, and an unfocused/occluded
    // WKWebView reports the page hidden — isDisplayed() then returns false
    // for elements that ARE in the DOM and every waitForDisplayed dies with
    // "... never appeared" (issue #32). The service's own self-heal is a
    // silent no-op (its plugin lacks get_window_states, and guard 1 above
    // disables it regardless), so force activation ourselves and assert the
    // page actually reports visible+focused before any spec runs.
    await ensureMacAppFocus();
    // Guard 3 (issue #364): make every `waitForDisplayed` re-resolve its
    // selector on each poll. `isDisplayed` caches `elementId` and never
    // re-runs the selector, and a detached node answers "not displayed"
    // without raising stale — so a re-render landing between the find and the
    // visibility check leaves the wait polling a dead node for its whole
    // budget while the element it wanted is on screen. That is the entire
    // #364 flake class, and a bigger timeout cannot fix it. The full
    // mechanism, and why this is an override rather than a helper, is in
    // `installStaleProofWaits`. Must run before the first `$()` below:
    // element overrides attach at element-creation time.
    await installStaleProofWaits();
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
  // re-rolled the reload race, and each loss was a full 30s script timeout.
  // #194 has since removed the roll (`refreshAndSettle`) and capped the loss,
  // so the multiplier is gone — but clearing here still needs no navigation at
  // all, which beats a cheap refresh. Reads as a rule worth keeping either way.
  after: async (_result, _caps, specFiles) => {
    try {
      await browser.execute(() => localStorage.clear());
    } catch {
      // Session already gone (crashed spec). The next launch inherits whatever
      // is on disk — exactly the pre-existing behaviour, so nothing to do.
    }
    // Name what this spec file paid in dropped scripts. Before #194 that was
    // most of the suite's wall time and nothing printed it: a stalled spec and
    // a genuinely slow one looked identical in the log, so "e2e is slow again"
    // was as precise as anyone could be. One line per spec file makes a
    // regression attributable — and `test/e2eRefreshGate.test.ts` is what
    // actually stops it landing.
    const line = formatScriptTiming(
      path.basename(specFiles[0] ?? "spec"),
      scriptTimingVerbose,
    );
    if (line) console.log(line);
  },
  // Heal mid-suite focus steals (another app grabbing foreground between
  // tests): one cheap execute per test when already focused, setFocus retry
  // loop only when the page reports hidden/unfocused. macOS only — no-op on
  // Linux CI.
  beforeTest: async () => {
    await ensureMacAppFocus();
  },
  beforeCommand: (commandName) => {
    if (SCRIPT_COMMANDS.has(commandName)) scriptStartedAt = Date.now();
  },
  afterCommand: (commandName) => {
    if (SCRIPT_COMMANDS.has(commandName)) {
      recordScriptDuration(Date.now() - scriptStartedAt);
    }
  },
  // One retry per spec FILE — the floor under the required gate, not a fix
  // (issue #364).
  //
  // The fixes are the guards in `before` and the waits themselves; this covers
  // what no wait can. A starved runner also loses the app itself — the
  // `app never rendered Welcome screen` companion line, seen in workers that
  // then passed — and one such loss failed the whole required check, which
  // taught everyone to read a red required check as noise. That is the more
  // expensive failure mode of the two.
  //
  // Safe here because every spec file builds its own fixtures: temp repos are
  // created in `beforeEach`/`before` and disposed in the matching `after*`, so
  // a re-run starts from the same state the first attempt did. (Not the same
  // hazard as #35's script retries, which re-ran a script whose side effects
  // had already landed inside one attempt — `executeOnce` owns that.)
  //
  // `Deferred` puts the retry at the END of this shard's queue instead of
  // immediately: a spec that lost a race to whatever else the runner was doing
  // gets to re-run under different conditions, and a genuinely broken spec
  // still fails, just later.
  //
  // A retry that hides a real regression is the risk, so a requeue is never
  // silent — `onWorkerEnd` below prints it, annotates the run and writes it to
  // the job summary. Read those lines: a spec that needed a retry on your PR
  // is a signal even when the gate is green.
  specFileRetries: 1,
  specFileRetriesDeferred: true,
  // Name every retried spec file, loudly, at the moment it is requeued.
  //
  // `retries` is the count REMAINING (the launcher's own `_endHandler` comment
  // says so; the type's "number of retries used" is wrong), so a nonzero
  // exit code with retries left is exactly "this failed and will be run
  // again". Printing here rather than in `onComplete` means the line appears
  // whether or not the retry then passes.
  onWorkerEnd: (cid, exitCode, specFiles, retries) => {
    if (exitCode === 0 || retries <= 0) return;
    const names = specFiles.map((s) => path.basename(s)).join(", ");
    const line = `[e2e] RETRY: ${names} failed on attempt 1 (worker ${cid}) — requeued, ${retries} retry left`;
    console.log(line);
    // GitHub annotation + job summary: the log of a green four-shard run is
    // not somewhere anyone looks, and a masked flake has to be visible from
    // the run page or it is not really reported. Both are no-ops locally.
    console.log(`::warning title=e2e spec retried::${names} failed on its first attempt (worker ${cid})`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      try {
        appendFileSync(summary, `- :repeat: **e2e retry** — \`${names}\` failed on attempt 1 (worker ${cid})\n`);
      } catch {
        // Summary file unavailable (not on Actions, or read-only mount). The
        // console lines above already carry the finding.
      }
    }
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
