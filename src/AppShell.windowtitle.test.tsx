// The OS window title names the active repository and branch (#217), so
// window switchers, the dock/taskbar and Mission Control stop showing
// identical "PlatypusGit" entries for every open window.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { newTab } from "@/features/repo/tabs";
import { useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { BranchInfo, RepoHandle } from "@/lib/types";

function branch(over: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "deadbeefcafe",
    tipTime: 0,
    isDefault: true,
    ...over,
  };
}

function wire() {
  for (const cmd of [
    "get_status",
    "list_all_files",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
    "get_reflog",
    "diff_commit",
    "diff_commits",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("take_launch_intent", () => null);
  mockInvoke("cli_shim_status", () => ({
    installed: false,
    shimPath: "",
    target: "",
    source: "none",
    pathState: "offPath",
  }));
  mockInvoke("get_diff", () => null);
  mockInvoke("check_for_update", () => null);
  mockInvoke("get_update_capability", () => ({ canSelfUpdate: false }));
}

/** Seed one already-open tab, bypassing the async open flow — same shortcut
 *  `AppShell.tabs.test.tsx`'s `seedTwoTabs` uses. */
function seedOpenTab(handle: RepoHandle, branches: BranchInfo[]) {
  useRepoStore.setState({ ...emptySlice(), current: handle, branches } as never);
  useTabsStore.setState({
    tabs: [newTab(handle.path, { status: "open", repoId: handle.id })],
    activePath: handle.path,
    activationSeq: 0,
    activating: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  useRecentsStore.setState({ recents: [] });
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    primaryId: null,
    pendingContentFocus: false,
  });
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
  useRepoStore.setState(emptySlice() as never);
  wire();
});

describe("AppShell — window title (#217)", () => {
  it("is just the app name with no repo open (Welcome)", async () => {
    render(<App />);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith("PlatypusGit"),
    );
  });

  it("names the repository and its checked-out branch", async () => {
    seedOpenTab({ id: "r1", path: "/dev/myrepo", head: "main" }, [
      branch({ name: "main", isHead: true }),
    ]);
    render(<App />);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith(
        "myrepo — main — PlatypusGit",
      ),
    );
  });

  it("shows the short OID instead of an empty segment when detached", async () => {
    // No branch has isHead — same as a real detached checkout, where nothing
    // in `branches` names the current position.
    seedOpenTab({ id: "r1", path: "/dev/myrepo", head: "abc1234567890" }, [
      branch({ name: "main", isHead: false }),
    ]);
    render(<App />);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith(
        "myrepo — abc1234 — PlatypusGit",
      ),
    );
  });

  it("omits the branch segment for an unborn branch (fresh init, no commits)", async () => {
    seedOpenTab({ id: "r1", path: "/dev/myrepo", head: null }, []);
    render(<App />);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith(
        "myrepo — PlatypusGit",
      ),
    );
  });

  it("follows a tab close back to the app name", async () => {
    seedOpenTab({ id: "r1", path: "/dev/myrepo", head: "main" }, [
      branch({ name: "main", isHead: true }),
    ]);
    render(<App />);
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith(
        "myrepo — main — PlatypusGit",
      ),
    );

    await act(async () => {
      await useTabsStore.getState().close("/dev/myrepo");
    });

    await waitFor(() =>
      expect(getCurrentWindow().setTitle).toHaveBeenCalledWith("PlatypusGit"),
    );
  });
});
