// Closing a tab must not pull the repository out from under a live merge
// resolver (#90 follow-up).
//
// The resolver is a separate Tauri window driving IPC with this repository's
// `RepoId`. Since closing a tab now calls `close_repo`, an unguarded close would
// make the resolver's next call answer `UnknownRepo` mid-resolution. The chosen
// behaviour: confirm in the MAIN window, then close the resolver and only evict
// once it is really gone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { PGDialogHost } from "@/design";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import {
  acceptDialog,
  dialogIsOpen,
  dialogTitle,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import {
  __resetMergeAttribution,
  openMergeWindow,
  watchMergeHolding,
} from "@/features/merge/openMergeWindow";
import { emitMockEvent } from "@/test/eventMock";
import { emptySlice } from "./repoSlice";
import { newTab } from "./tabs";
import { useRepoStore } from "./useRepoStore";
import { useTabsStore } from "./useTabsStore";

const API = { id: "r-api", path: "/dev/api", head: "main" };
const WEB = { id: "r-web", path: "/dev/web", head: "main" };

const getByLabel = WebviewWindow.getByLabel as unknown as ReturnType<typeof vi.fn>;

function armBackend() {
  mockInvoke("open_repo", (args) => (args.path === API.path ? API : WEB));
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("list_all_files", () => []);
}

/** Two open tabs, /dev/api active and live. */
function seedTwoTabs() {
  useRepoStore.setState({ ...emptySlice(), current: API } as never);
  useTabsStore.setState({
    tabs: [
      newTab("/dev/api", { status: "open", repoId: "r-api" }),
      newTab("/dev/web", {
        status: "open",
        repoId: "r-web",
        slice: { ...emptySlice(), current: WEB },
      }),
    ],
    activePath: "/dev/api",
    activationSeq: 0,
    activating: null,
  });
}

/** A live resolver window whose `close()` makes it disappear, so the store's
 *  wait-for-gone poll has something real to observe. */
function armLiveMergeWindow() {
  const win = {
    label: "merge",
    close: vi.fn().mockImplementation(async () => {
      getByLabel.mockResolvedValue(null);
    }),
    setFocus: vi.fn().mockResolvedValue(undefined),
    once: vi.fn().mockResolvedValue(() => {}),
  };
  getByLabel.mockResolvedValue(win);
  return win;
}

const closeRepoCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "close_repo");

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  resetDialogs();
  armBackend();
  getByLabel.mockReset();
  getByLabel.mockResolvedValue(null);
  // Module state, so it survives between tests — a stale attribution would make
  // the unattributed case silently test the attributed one.
  __resetMergeAttribution();
  seedTwoTabs();
});

describe("closing a tab with the merge resolver open", () => {
  it("confirms first, and declining leaves the tab AND the resolver alone", async () => {
    render(<PGDialogHost />);
    const win = armLiveMergeWindow();

    const closing = useTabsStore.getState().close("/dev/api");
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    expect(dialogTitle()).toBe("Close this repository and its merge resolver?");
    await dismissDialog();
    await closing;

    // Nothing happened: no eviction, no window close, tab still there.
    expect(closeRepoCalls()).toHaveLength(0);
    expect(win.close).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      "/dev/api",
      "/dev/web",
    ]);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
  });

  it("closes the resolver BEFORE evicting the repository", async () => {
    render(<PGDialogHost />);
    const win = armLiveMergeWindow();

    const closing = useTabsStore.getState().close("/dev/api");
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    await acceptDialog();
    await closing;

    expect(win.close).toHaveBeenCalledOnce();
    // The eviction happened, and only after the window was gone — `close()`'s
    // implementation is what makes getByLabel report null, so a `close_repo`
    // issued earlier would have run against a still-live resolver.
    expect(closeRepoCalls().map((c) => c.args.repoId)).toEqual(["r-api"]);
    expect(await WebviewWindow.getByLabel("merge")).toBeNull();
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
    expect(useTabsStore.getState().activePath).toBe("/dev/web");
  });

  it("does not prompt when the resolver belongs to another repository", async () => {
    render(<PGDialogHost />);
    // Attribute the window to /dev/web by opening it for that repo, then make it
    // live. Closing /dev/api must not involve it.
    await openMergeWindow("r-web");
    armLiveMergeWindow();

    await useTabsStore.getState().close("/dev/api");

    expect(dialogIsOpen()).toBe(false);
    expect(closeRepoCalls().map((c) => c.args.repoId)).toEqual(["r-api"]);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
  });

  it("prompts for a resolver this page instance cannot attribute", async () => {
    render(<PGDialogHost />);
    // Main reloaded while the resolver stayed up: the window is live but nothing
    // records which repository it is on. Prompting once beats breaking it.
    armLiveMergeWindow();

    const closing = useTabsStore.getState().close("/dev/api");
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    await acceptDialog();
    await closing;

    expect(closeRepoCalls().map((c) => c.args.repoId)).toEqual(["r-api"]);
  });

  it("closes normally with no resolver open", async () => {
    render(<PGDialogHost />);

    await useTabsStore.getState().close("/dev/api");

    expect(dialogIsOpen()).toBe(false);
    expect(closeRepoCalls().map((c) => c.args.repoId)).toEqual(["r-api"]);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
  });
});

describe("the resolver's own announcement (#256)", () => {
  // With several repository windows, "a resolver is up" stopped being a good
  // enough reason to confirm: the window closing a tab may not be the one that
  // opened the resolver, and every window opens its OWN RepoId — so its close
  // cannot break the resolver. `merge://holding` is what lets the guard tell
  // the two cases apart. Fired via the store's real close path, so the
  // assertion is on the behaviour the user sees, not on the predicate.
  it("does not confirm when the resolver names a DIFFERENT repository", async () => {
    render(<PGDialogHost />);
    armLiveMergeWindow();
    // This window never opened the resolver — the attribution comes from the
    // announcement alone. AppShell starts this listener at mount, long before
    // any tab is closed, which is the point: a listener registered at close
    // time would already have missed the announcement.
    watchMergeHolding();
    emitMockEvent("merge://holding", { repoId: "r-web" });

    await useTabsStore.getState().close("/dev/api");

    expect(dialogIsOpen()).toBe(false);
    expect(closeRepoCalls().map((c) => c.args.repoId)).toEqual(["r-api"]);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
  });

  it("still confirms when the announcement names THIS repository", async () => {
    render(<PGDialogHost />);
    armLiveMergeWindow();
    watchMergeHolding();
    emitMockEvent("merge://holding", { repoId: "r-api" });

    const closing = useTabsStore.getState().close("/dev/api");
    await waitFor(() => expect(dialogIsOpen()).toBe(true));
    await dismissDialog();
    await closing;

    expect(closeRepoCalls()).toHaveLength(0);
  });
});
