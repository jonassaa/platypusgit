/**
 * @vitest-environment node
 */
// The script-timeout cap and the stall counter (issue #194).
//
// Both halves exist because a dropped in-page script costs the TIMEOUT rather
// than the work: an `execute()` landing mid-document-swap loses its completion
// handler, and the driver then waits out the whole W3C script timeout. The cap
// bounds that; the counter is how a regression becomes visible instead of
// "e2e is slow again".
//
// The resolver is tested for one specific reason: getting it wrong does not
// look like a bad number. `E2E_SCRIPT_TIMEOUT_MS` is forwarded by
// docker-compose as the EMPTY STRING when unset on the host, `??` only catches
// null/undefined, and `Number("")` is 0 — so the natural spelling yields a ZERO
// script timeout, under which the driver fails every `element`, `elements` and
// click instantly (WebKit runs those through injected JS too). Measured: an
// otherwise-green suite went to "Script execution timed out" on every command
// and read as a broken session.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  formatScriptTiming,
  resolveScriptTimeoutMs,
  scriptTiming,
  STALL_MS,
} from "../e2e/support/scriptTiming";

describe("resolveScriptTimeoutMs", () => {
  it("falls back per platform when no override is set", () => {
    expect(resolveScriptTimeoutMs({}, "darwin")).toBe(
      DEFAULT_SCRIPT_TIMEOUT_MS.darwin,
    );
    expect(resolveScriptTimeoutMs({}, "linux")).toBe(
      DEFAULT_SCRIPT_TIMEOUT_MS.other,
    );
  });

  it("treats compose's empty-string passthrough as unset, not as zero", () => {
    // The bug this file exists for.
    expect(resolveScriptTimeoutMs({ E2E_SCRIPT_TIMEOUT_MS: "" }, "linux")).toBe(
      DEFAULT_SCRIPT_TIMEOUT_MS.other,
    );
    expect(
      resolveScriptTimeoutMs({ E2E_SCRIPT_TIMEOUT_MS: "   " }, "linux"),
    ).toBe(DEFAULT_SCRIPT_TIMEOUT_MS.other);
  });

  it("refuses zero and junk — a zero timeout fails every driver command", () => {
    for (const raw of ["0", "-1", "nope", "NaN"]) {
      expect(
        resolveScriptTimeoutMs({ E2E_SCRIPT_TIMEOUT_MS: raw }, "linux"),
      ).toBe(DEFAULT_SCRIPT_TIMEOUT_MS.other);
    }
  });

  it("honours a real override, so the cap can be probed against", () => {
    // `E2E_SCRIPT_TIMEOUT_MS=30000` restores the driver default — how the
    // stall fix was measured with the cap held constant.
    expect(
      resolveScriptTimeoutMs({ E2E_SCRIPT_TIMEOUT_MS: "30000" }, "linux"),
    ).toBe(30_000);
    expect(
      resolveScriptTimeoutMs({ E2E_SCRIPT_TIMEOUT_MS: " 1500 " }, "darwin"),
    ).toBe(1500);
  });

  it("keeps the Linux cap well clear of the measured worst legitimate script", () => {
    // Slowest in-page script anywhere in the suite is 12ms in local Docker and
    // 190ms on a real CI runner, so no legitimate script may sit anywhere near
    // STALL_MS — the counter would otherwise report work as a stall.
    expect(DEFAULT_SCRIPT_TIMEOUT_MS.other).toBeGreaterThan(STALL_MS);
    expect(DEFAULT_SCRIPT_TIMEOUT_MS.other).toBeLessThan(30_000);
  });
});

describe("script stall accounting", () => {
  it("counts only scripts at or past the stall threshold, and their cost", () => {
    const t = scriptTiming([5, 12, 8, STALL_MS, STALL_MS + 1_000]);
    expect(t.scripts).toBe(5);
    expect(t.stalls).toBe(2);
    expect(t.stalledMs).toBe(STALL_MS * 2 + 1_000);
    expect(t.slowestMs).toBe(STALL_MS + 1_000);
  });

  it("prints sub-second durations in ms — a healthy suite is all sub-second", () => {
    const line = formatScriptTiming("keymap.e2e.ts", false, scriptTiming([6, 12]));
    expect(line).toContain("2 driver scripts");
    expect(line).toContain("0 stalled");
    expect(line).toContain("slowest 12ms");
    expect(line).not.toContain("0.0s"); // what `toFixed(1)` alone would print
  });

  it("names the fix in the warning, so the reader knows where to look", () => {
    const line = formatScriptTiming("keymap.e2e.ts", false, scriptTiming([STALL_MS]));
    expect(line).toContain("WARN");
    expect(line).toContain("refreshAndSettle");
  });

  it("stays silent when a spec ran no scripts at all", () => {
    expect(formatScriptTiming("empty.e2e.ts", false, scriptTiming([]))).toBeNull();
  });

  it("adds the percentile spread only when asked (E2E_SCRIPT_TIMING=1)", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 900];
    expect(formatScriptTiming("s", false, scriptTiming(samples))).not.toContain("p50");
    const verbose = formatScriptTiming("s", true, scriptTiming(samples));
    expect(verbose).toContain("p50");
    expect(verbose).toContain("max 900ms");
  });
});
