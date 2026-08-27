// The folder picker is the one step on the open-a-repository path that the log
// cannot see: `open` is plugin-dialog's own IPC call, so neither lib/tauri.ts's
// invoke logging nor its stall watchdog covers it. Combined with every caller
// using `void openRepoDialog()`, a rejection was an unhandled one — clicking
// "Open repository" did nothing, forever, and left no trace anywhere (#274).
//
// A stock WSL install typically has no xdg-desktop-portal, which is exactly the
// environment that makes `open` reject.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { error as logError } from "@tauri-apps/plugin-log";

import { openRepoDialog } from "./ops";
import { useTabsStore } from "./useTabsStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(logError).mockClear();
});

describe("the open-repository folder picker", () => {
  it("logs and reports a picker that will not open, instead of failing silently", async () => {
    vi.mocked(open).mockRejectedValue(
      new Error("Failed to open portal: org.freedesktop.portal.Desktop"),
    );
    const openRepo = vi
      .spyOn(useTabsStore.getState(), "openRepo")
      .mockResolvedValue(undefined);

    // Must not reject: every call site is `void openRepoDialog()`, so a
    // rejection here is unhandled and invisible.
    await expect(openRepoDialog()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(logError).mock.calls[0][0]);
    expect(line).toContain("folder picker failed");
    // The reason travels, not `[object Object]`.
    expect(line).toContain("portal");
    expect(openRepo).not.toHaveBeenCalled();
  });

  it("says nothing when the user simply cancels", async () => {
    // `open` resolves to null for a cancel. That is the user getting what they
    // asked for, and logging it as a failure would train people to ignore the
    // line that matters.
    vi.mocked(open).mockResolvedValue(null);
    const openRepo = vi
      .spyOn(useTabsStore.getState(), "openRepo")
      .mockResolvedValue(undefined);

    await openRepoDialog();

    expect(logError).not.toHaveBeenCalled();
    expect(openRepo).not.toHaveBeenCalled();
  });

  it("still opens the repository the user picked", async () => {
    vi.mocked(open).mockResolvedValue("/mnt/c/dev/app");
    const openRepo = vi
      .spyOn(useTabsStore.getState(), "openRepo")
      .mockResolvedValue(undefined);

    await openRepoDialog();

    expect(openRepo).toHaveBeenCalledWith("/mnt/c/dev/app");
    expect(logError).not.toHaveBeenCalled();
  });
});
