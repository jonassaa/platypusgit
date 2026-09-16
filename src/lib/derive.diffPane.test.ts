// A refresh of the file already on screen is not a reason to empty the pane
// (#470). The engine half of this — that emptying it also destroys the reader's
// scroll position, because the content collapses and `scrollTop` is clamped —
// is measured in `e2e/specs/diff-live-refresh.e2e.ts`. This pins the rule that
// decides it.

import { describe, expect, it } from "vitest";

import { diffPaneWaiting } from "./derive";

const SHOWING = "src/lobby/member.ts:unstaged";

describe("diffPaneWaiting", () => {
  it("is false when no fetch is in flight", () => {
    expect(
      diffPaneWaiting({ loading: false, diffFor: SHOWING, showing: SHOWING, hasDiff: true }),
    ).toBe(false);
  });

  it("waits on a FIRST open — there is nothing to keep showing", () => {
    expect(
      diffPaneWaiting({ loading: true, diffFor: null, showing: SHOWING, hasDiff: false }),
    ).toBe(true);
  });

  it("waits when the reader switched to a DIFFERENT file", () => {
    // The outgoing file's diff is still in state; showing it under the new
    // file's header would be a lie about which file this is.
    expect(
      diffPaneWaiting({
        loading: true,
        diffFor: "src/lobby/index.ts:unstaged",
        showing: SHOWING,
        hasDiff: true,
      }),
    ).toBe(true);
  });

  it("waits when the other SIDE of the same file is selected", () => {
    // The two sides of one file are two different diffs, which is why the key
    // carries the side and a bare path would not do.
    expect(
      diffPaneWaiting({
        loading: true,
        diffFor: "src/lobby/member.ts:staged",
        showing: SHOWING,
        hasDiff: true,
      }),
    ).toBe(true);
  });

  it("does NOT wait while refetching the file already on screen", () => {
    // The regression. This is every background refresh the filesystem watcher
    // triggers, and blanking here is what threw the reader back to the top.
    expect(
      diffPaneWaiting({ loading: true, diffFor: SHOWING, showing: SHOWING, hasDiff: true }),
    ).toBe(false);
  });

  it("waits when the key matches but the diff itself is gone", () => {
    // `hasDiff` is not implied by a matching key: a failed fetch clears the
    // diff while the selection stays put, and there is then nothing to keep.
    expect(
      diffPaneWaiting({ loading: true, diffFor: SHOWING, showing: SHOWING, hasDiff: false }),
    ).toBe(true);
  });

  it("does not treat two unset keys as a match", () => {
    // `diffFor` null and `showing` "" must not read as "the same file", or a
    // pane with no selection would decline to show its spinner forever.
    expect(
      diffPaneWaiting({ loading: true, diffFor: null, showing: "", hasDiff: true }),
    ).toBe(true);
  });
});
