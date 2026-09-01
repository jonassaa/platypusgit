// The watcher's wiring (#239): the watch follows the repository and the
// setting, and an event refreshes the right amount.
//
// `fsWatchPlan.test.ts` pins the DECISION. This file pins that the decision is
// actually reached — that the subscription exists, that the backend is told
// which repository to watch, and that turning the setting off really stops it.
// A correct policy nobody calls is the failure these tests exist to catch.

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitMockEvent, resetEventMock } from "@/test/eventMock";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { FsChange } from "@/lib/types";

import { useFsWatch } from "./useFsWatch";
import { useRepoStore } from "./useRepoStore";

function Probe({ repoId }: { repoId: string | null }) {
  useFsWatch(repoId);
  return null;
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

const refreshAll = vi.fn();
const refreshStatus = vi.fn();

function setRepo(id: string | null, activity: Record<string, unknown> = {}) {
  useRepoStore.setState({
    current: id ? { id, path: "/repo", head: "refs/heads/main" } : null,
    activity,
    refreshAll,
    refreshStatus,
  } as never);
}

const fire = (over?: Partial<FsChange>) =>
  emitMockEvent("fs://changed", {
    repoId: "repo-1",
    refsMoved: false,
    ...over,
  } satisfies FsChange);

beforeEach(() => {
  resetInvokeMock();
  resetEventMock();
  refreshAll.mockReset().mockResolvedValue(undefined);
  refreshStatus.mockReset().mockResolvedValue(undefined);
  mockInvoke("watch_repo", () => null);
  mockInvoke("watch_stop", () => null);
  useSettingsStore.getState().reset();
  setRepo("repo-1");
});

describe("starting and stopping the watch", () => {
  it("watches the open repository", async () => {
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    expect(calls("watch_repo")[0].args.repoId).toBe("repo-1");
  });

  it("does not watch when the setting is off, and stops any running watch", async () => {
    useSettingsStore.getState().set("watchFilesystem", false);
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_stop").length).toBeGreaterThan(0));
    expect(calls("watch_repo")).toHaveLength(0);
  });

  it("does not watch when no repository is open", async () => {
    render(<Probe repoId={null} />);
    await waitFor(() => expect(calls("watch_stop").length).toBeGreaterThan(0));
    expect(calls("watch_repo")).toHaveLength(0);
  });

  it("stops watching when the component goes away", async () => {
    const { unmount } = render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    unmount();
    await waitFor(() => expect(calls("watch_stop").length).toBeGreaterThan(0));
  });
});

describe("what an event does", () => {
  it("refreshes status for a working-copy change", async () => {
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    fire();
    await waitFor(() => expect(refreshStatus).toHaveBeenCalledTimes(1));
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("refreshes everything when a ref moved", async () => {
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    fire({ refsMoved: true });
    await waitFor(() => expect(refreshAll).toHaveBeenCalledTimes(1));
  });

  it("ignores an event for another repository", async () => {
    // The half of the multi-repo guard a single-slot watcher cannot provide:
    // the tab switched while this event was already in flight.
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    fire({ repoId: "repo-2", refsMoved: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshStatus).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("ignores an event while an operation is in flight", async () => {
    setRepo("repo-1", { rebase: { label: "Rebasing" } });
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    fire({ refsMoved: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("does NOT clear an error banner the user has not read", async () => {
    // The regression this fixes, and the sequence that produced it:
    //
    //   1. an `--ff-only` pull on a diverged branch fails and sets `error`;
    //   2. the FETCH half of that same pull already moved `refs/remotes/…`;
    //   3. the watcher's DEBOUNCED event lands a few hundred ms later — after
    //      the operation cleared `activity`, so the busy guard no longer
    //      suppresses it;
    //   4. `refreshAll` opens with `set({ error: null })` and wipes the banner.
    //
    // The user sees a pull that silently did nothing, which is the worst
    // possible reading of a failure. `settings.e2e.ts` caught it on CI.
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));

    fire({ refsMoved: true });
    await waitFor(() => expect(refreshAll).toHaveBeenCalledTimes(1));
    expect(refreshAll).toHaveBeenCalledWith({ preserveError: true });
  });

  it("preserves the error on a status-only refresh too", async () => {
    // Both refresh paths clear `error`, so both need it — a working-copy write
    // arriving after a failed operation is the same story.
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));

    fire();
    await waitFor(() => expect(refreshStatus).toHaveBeenCalledTimes(1));
    expect(refreshStatus).toHaveBeenCalledWith({ preserveError: true });
  });

  it("survives a refresh that throws, and keeps working afterwards", async () => {
    // A background refresh must not raise a banner the user cannot connect to
    // anything they did — but it must also not wedge the listener.
    refreshStatus.mockRejectedValueOnce(new Error("boom"));
    render(<Probe repoId="repo-1" />);
    await waitFor(() => expect(calls("watch_repo")).toHaveLength(1));
    fire();
    await waitFor(() => expect(refreshStatus).toHaveBeenCalledTimes(1));
    fire();
    await waitFor(() => expect(refreshStatus).toHaveBeenCalledTimes(2));
  });
});
