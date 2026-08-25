// The OS window title names the active repository and its checked-out
// branch (#217) — otherwise every window shows the identical "PlatypusGit"
// in the window switcher, dock, and Mission Control.

import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { newTab } from "@/features/repo/tabs";
import { useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { HeadInfo, RepoHandle } from "@/lib/types";

const REPO: RepoHandle = { id: "r-1", path: "/dev/myrepo", head: "main" };

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
  mockInvoke("open_repo", () => REPO);
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("head_info", (): HeadInfo => ({ branch: "main", headOid: "a".repeat(40) }));
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

function currentTitle(): string {
  const win = getCurrentWindow();
  const calls = (win.setTitle as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[calls.length - 1]?.[0] as string;
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
  (getCurrentWindow().setTitle as unknown as { mockClear: () => void }).mockClear();
  wire();
});

describe("AppShell — window title", () => {
  it("is just the app name with no repo open", async () => {
    render(<App />);
    await waitFor(() => expect(currentTitle()).toBe("PlatypusGit"));
  });

  it("names the repo and its branch once a repo is open", async () => {
    useRepoStore.setState({
      ...emptySlice(),
      current: REPO,
      headInfo: { branch: "main", headOid: "a".repeat(40) },
    } as never);
    useTabsStore.setState({
      tabs: [newTab("/dev/myrepo", { status: "open", repoId: "r-1" })],
      activePath: "/dev/myrepo",
      activationSeq: 0,
      activating: null,
    });
    render(<App />);
    await waitFor(() =>
      expect(currentTitle()).toBe("myrepo — main — PlatypusGit"),
    );
  });

  it("shows the short oid on a detached HEAD instead of an empty segment", async () => {
    useRepoStore.setState({
      ...emptySlice(),
      current: REPO,
      headInfo: { branch: null, headOid: "abc1234def5678" },
    } as never);
    useTabsStore.setState({
      tabs: [newTab("/dev/myrepo", { status: "open", repoId: "r-1" })],
      activePath: "/dev/myrepo",
      activationSeq: 0,
      activating: null,
    });
    render(<App />);
    await waitFor(() =>
      expect(currentTitle()).toBe("myrepo — abc1234 — PlatypusGit"),
    );
  });

  it("drops the branch segment on an unborn branch", async () => {
    useRepoStore.setState({
      ...emptySlice(),
      current: REPO,
      headInfo: { branch: null, headOid: null },
    } as never);
    useTabsStore.setState({
      tabs: [newTab("/dev/myrepo", { status: "open", repoId: "r-1" })],
      activePath: "/dev/myrepo",
      activationSeq: 0,
      activating: null,
    });
    render(<App />);
    await waitFor(() => expect(currentTitle()).toBe("myrepo — PlatypusGit"));
  });

  it("returns to the app name alone after the repo closes", async () => {
    useRepoStore.setState({
      ...emptySlice(),
      current: REPO,
      headInfo: { branch: "main", headOid: "a".repeat(40) },
    } as never);
    useTabsStore.setState({
      tabs: [newTab("/dev/myrepo", { status: "open", repoId: "r-1" })],
      activePath: "/dev/myrepo",
      activationSeq: 0,
      activating: null,
    });
    render(<App />);
    await waitFor(() =>
      expect(currentTitle()).toBe("myrepo — main — PlatypusGit"),
    );

    useRepoStore.setState(emptySlice() as never);
    useTabsStore.setState({
      tabs: [],
      activePath: null,
      activationSeq: 0,
      activating: null,
    });
    await waitFor(() => expect(currentTitle()).toBe("PlatypusGit"));
  });
});
