// Store-logic tests for the busy guard on openClone/openInit: a running dialog
// is deliberately non-dismissable, so switching `open` to the other dialog
// mid-run would unmount the running dialog's view behind a disabled one with a
// dead backdrop/Escape, and the run's eventual result (including a failure)
// would land in the wrong dialog's error slot. A clone can be cancelled now
// (#234) and the guard matters MORE for it, not less: the cancel button lives
// in the running dialog, so swapping that dialog away hides the only way out.
import { describe, it, expect, beforeEach } from "vitest";

import { useCreateStore } from "./useCreateStore";

describe("useCreateStore busy guard", () => {
  beforeEach(() => {
    useCreateStore.setState({
      open: "none",
      busy: false,
      progress: null,
      error: null,
    });
  });

  it("openInit is a no-op while a clone is running", () => {
    useCreateStore.setState({
      open: "clone",
      busy: true,
      progress: { phase: "Receiving objects", percent: 40 },
      error: null,
    });

    useCreateStore.getState().openInit();

    expect(useCreateStore.getState().open).toBe("clone");
    // The guard bails out before touching anything else too — a running
    // clone's live progress must not be cleared by a swap attempt.
    expect(useCreateStore.getState().progress).toEqual({
      phase: "Receiving objects",
      percent: 40,
    });
  });

  it("openClone is a no-op while an init is running", () => {
    useCreateStore.setState({
      open: "init",
      busy: true,
      progress: null,
      error: null,
    });

    useCreateStore.getState().openClone();

    expect(useCreateStore.getState().open).toBe("init");
  });

  it("openClone still opens normally once nothing is running", () => {
    useCreateStore.setState({ open: "none", busy: false });

    useCreateStore.getState().openClone();

    expect(useCreateStore.getState().open).toBe("clone");
  });

  it("openInit still opens normally once nothing is running", () => {
    useCreateStore.setState({ open: "none", busy: false });

    useCreateStore.getState().openInit();

    expect(useCreateStore.getState().open).toBe("init");
  });
});
