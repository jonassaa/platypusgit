// The stall watchdog is the only line this module logs while a call is still
// outstanding, and it exists because of a failure the log could not describe:
// four WSL launches recorded `check_for_update` and then nothing at all, and
// nobody could tell an `open_repo` that hung from an `open_repo` that was never
// issued (#274). Both look like silence.
//
// So these tests pin the property that matters — a call that never comes back
// leaves a line naming itself — and, just as importantly, that a healthy call
// leaves no such line. A watchdog that cries wolf on every launch gets ignored,
// and an ignored watchdog is the bug all over again.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { warn as logWarn } from "@tauri-apps/plugin-log";

import { mockInvoke } from "@/test/invokeMock";
import { getStatus } from "./tauri";

/** Mirrors `STALL_INVOKE_MS` in tauri.ts. */
const STALL_MS = 10_000;

function stallLines(): string[] {
  return vi
    .mocked(logWarn)
    .mock.calls.map((c) => String(c[0]))
    .filter((line) => line.includes("still pending"));
}

describe("the invoke stall watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a call that has not come back", async () => {
    // A hang, modelled honestly: a promise with no path to settling. This is
    // what a `git2` call blocked on a stat over WSL's 9p mount looks like from
    // the webview — indefinitely pending, never rejected.
    mockInvoke("get_status", () => new Promise<never>(() => {}));

    const pending = getStatus("r1");
    expect(stallLines()).toEqual([]);

    await vi.advanceTimersByTimeAsync(STALL_MS);

    const lines = stallLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("get_status");

    // Leave nothing dangling for the next test; the call itself never settles.
    void pending.catch(() => {});
  });

  it("stays quiet for a call that returns in time", async () => {
    mockInvoke("get_status", () => []);

    await expect(getStatus("r1")).resolves.toEqual([]);
    // Well past the threshold: the timer must have been cleared, not merely
    // not-yet-fired. `finally` is what guarantees this.
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    expect(stallLines()).toEqual([]);
  });

  it("stays quiet for a call that fails fast", async () => {
    // The `catch` arm returns via `throw`, so only a `finally` clears the timer
    // here. Without one, every backend error would be followed ten seconds
    // later by a phantom "still pending" line for a call that had long since
    // reported its reason — noise that would make the watchdog untrustworthy
    // exactly where the log is most read.
    mockInvoke("get_status", () => {
      throw { kind: "NotARepo", message: "not a git repository" };
    });

    await expect(getStatus("r1")).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    expect(stallLines()).toEqual([]);
  });
});
