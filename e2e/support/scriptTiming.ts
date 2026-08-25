/**
 * Driver-script timing, so a stall regression is VISIBLE instead of showing up
 * as "e2e is slow again" (issue #194).
 *
 * The stall this counts is not a slow test. An `execute()` that lands while a
 * `refresh()` navigation is mid-document-swap has its completion handler
 * dropped, and the driver then waits out the whole W3C script timeout before
 * erroring — so the cost per stall is the CAP, not the work. That made the
 * suite's wall time a function of how many times the harness rolled that die:
 * 13 stalls in a 9m19s run, 23 in a 13m55s one, ~30s each, i.e. 70-80% of the
 * total. `refreshAndSettle` (e2e/support/app.ts) removes the roll and the cap
 * in wdio.conf bounds whatever is left; this module is how we can tell.
 *
 * Every in-page script the suite runs finishes in milliseconds — the whole
 * point of `STALL_MS` is that no legitimate script comes near it, so a nonzero
 * count means the refresh discipline broke somewhere, not that a spec got
 * heavier. The conf prints the summary per spec FILE, which is also the
 * granularity #194 measured in: a stall is attributable, and a spec whose time
 * is `n x cap` plus small change names its own `n`.
 */

/** The W3C script-timeout cap the run should use, per platform.
 *
 *  macOS (WKWebView) finishes in-page scripts in single-digit milliseconds, so
 *  it keeps the tight 2.5s bound it has had since the guard was introduced.
 *  Linux/xvfb shares a CI runner and is slower, so it gets a wider one — still
 *  measured against a suite whose slowest legitimate script is ~12ms. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = { darwin: 2500, other: 8000 } as const;

/**
 * Resolve the cap from `E2E_SCRIPT_TIMEOUT_MS`, falling back per platform.
 *
 * Split out of `wdio.conf.ts` and tested because the obvious spelling —
 * `Number(env.E2E_SCRIPT_TIMEOUT_MS ?? default)` — is wrong in a way that looks
 * nothing like a bad number. docker-compose forwards an UNSET host variable as
 * the empty string, `??` only catches null/undefined, and `Number("")` is 0. A
 * zero script timeout makes the driver fail EVERY command instantly — `element`,
 * `elements`, even clicks, since WebKit runs those through injected JS too — so
 * the whole session reads as broken. Anything not a positive finite number is
 * therefore the default, `"0"` included.
 */
export function resolveScriptTimeoutMs(
  env: Record<string, string | undefined>,
  platform: string,
): number {
  const override = Number(env.E2E_SCRIPT_TIMEOUT_MS?.trim());
  if (Number.isFinite(override) && override > 0) return override;
  return platform === "darwin"
    ? DEFAULT_SCRIPT_TIMEOUT_MS.darwin
    : DEFAULT_SCRIPT_TIMEOUT_MS.other;
}

/** A script slower than this is a dropped completion handler, not work.
 *
 *  Sized off the measured distribution under xvfb, where the slowest legitimate
 *  in-page script is comfortably under a second: high enough that a loaded CI
 *  runner cannot trip it, far below the cap so a stall always lands above it. */
export const STALL_MS = 5_000;

const durations: number[] = [];

export function recordScriptDuration(ms: number): void {
  durations.push(ms);
}

/** Test seam — the conf never calls this (one process per spec file). */
export function resetScriptDurations(): void {
  durations.length = 0;
}

export interface ScriptTiming {
  scripts: number;
  stalls: number;
  stalledMs: number;
  slowestMs: number;
  /** Sorted ascending — the percentile source for the verbose line. */
  sortedMs: number[];
}

export function scriptTiming(samples: readonly number[] = durations): ScriptTiming {
  const sortedMs = [...samples].sort((a, b) => a - b);
  const stalled = sortedMs.filter((ms) => ms >= STALL_MS);
  return {
    scripts: sortedMs.length,
    stalls: stalled.length,
    stalledMs: stalled.reduce((a, b) => a + b, 0),
    slowestMs: sortedMs[sortedMs.length - 1] ?? 0,
    sortedMs,
  };
}

const pct = (sorted: readonly number[], p: number): number =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Milliseconds below a second, seconds above. A healthy suite's numbers are
 *  ALL sub-second — printing them as "0.0s" would hide the very distribution
 *  this line exists to show (it is how the Linux cap is sized). */
const secs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

/**
 * One line for the spec file's log, or `null` when nothing ran.
 *
 * `verbose` (E2E_SCRIPT_TIMING=1) adds the percentile spread — that is how the
 * Linux cap was sized, and how to re-size it if the app ever grows a
 * legitimately slow in-page script.
 */
export function formatScriptTiming(
  specName: string,
  verbose = false,
  timing: ScriptTiming = scriptTiming(),
): string | null {
  if (timing.scripts === 0) return null;
  const head =
    `[e2e] ${specName}: ${timing.scripts} driver scripts, ` +
    `${timing.stalls} stalled (>=${secs(STALL_MS)}), ` +
    `${secs(timing.stalledMs)} lost, slowest ${secs(timing.slowestMs)}`;
  const warn =
    timing.stalls > 0
      ? `\n[e2e] WARN ${timing.stalls} script stall(s) — a refresh site is firing ` +
        "execute() before a matched find (see refreshAndSettle, issue #194)"
      : "";
  if (!verbose) return head + warn;
  const s = timing.sortedMs;
  return (
    head +
    `\n[e2e]   p50 ${secs(pct(s, 50))} p90 ${secs(pct(s, 90))} ` +
    `p99 ${secs(pct(s, 99))} max ${secs(timing.slowestMs)}` +
    warn
  );
}
