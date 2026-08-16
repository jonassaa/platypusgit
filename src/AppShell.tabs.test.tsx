// Tabs in the shell (#90): the strip renders, each tab remembers its own screen
// within the session, and a switch REMOUNTS the screen so one repository's
// selections cannot show up under another's.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { newTab } from "@/features/repo/tabs";
import { useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { RepoHandle } from "@/lib/types";

const API: RepoHandle = { id: "r-api", path: "/dev/api", head: "refs/heads/main" };
const WEB: RepoHandle = { id: "r-web", path: "/dev/web", head: "refs/heads/trunk" };

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
  mockInvoke("open_repo", (args) => (args.path === API.path ? API : WEB));
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
  mockInvoke("cli_shim_status", () => ({ installed: false, path: null }));
  mockInvoke("get_diff", () => null);
  mockInvoke("check_for_update", () => null);
  mockInvoke("get_update_capability", () => ({ canSelfUpdate: false }));
}

/** Two tabs, /dev/api active and live in the repo store. */
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

const rows = () =>
  Array.from(document.querySelectorAll('[data-testid="repo-tab"]'));
const activeScreen = () =>
  document.querySelector('[data-activity][style*="var(--accent)"]');

describe("AppShell — repository tabs", () => {
  it("renders no strip until a repository is open", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelector('[data-testid="repo-tab-strip"]')).toBeNull(),
    );
  });

  it("renders one tab per open repository", async () => {
    seedTwoTabs();
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((r) => r.getAttribute("data-active"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("remembers each tab's screen across a switch", async () => {
    seedTwoTabs();
    const { container } = render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    // Put /dev/api on Branches…
    await act(async () => {
      fireEvent.click(
        container.querySelector('[data-activity="branches"]') as Element,
      );
    });
    expect(useTabsStore.getState().tabs[0].screen).toBe("branches");

    // …switch to /dev/web, which has never left History…
    await act(async () => {
      fireEvent.click(rows()[1]);
    });
    await waitFor(() =>
      expect(useTabsStore.getState().activePath).toBe("/dev/web"),
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-activity="history"]')?.getAttribute("style"),
      ).toContain("var(--accent)"),
    );

    // …and back: /dev/api is where we left it.
    await act(async () => {
      fireEvent.click(rows()[0]);
    });
    await waitFor(() =>
      expect(
        container.querySelector('[data-activity="branches"]')?.getAttribute("style"),
      ).toContain("var(--accent)"),
    );
  });

  it("closes the active tab from the titlebar button", async () => {
    seedTwoTabs();
    const { container } = render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const close = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Close repo",
    );
    await act(async () => {
      fireEvent.click(close as Element);
    });
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
        "/dev/web",
      ]),
    );
    expect(useTabsStore.getState().activePath).toBe("/dev/web");
  });

  it("restores the persisted session on mount, opening only the active tab", async () => {
    localStorage.setItem(
      "pg-open-repos",
      JSON.stringify({ paths: ["/dev/api", "/dev/web"], active: "/dev/web" }),
    );
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() =>
      expect(useRepoStore.getState().current?.id).toBe("r-web"),
    );
    expect(useTabsStore.getState().tabs[0].status).toBe("pending");
    // Restored tabs start on History — `pg-screen` stays dead.
    expect(useTabsStore.getState().tabs.map((t) => t.screen)).toEqual([
      "history",
      "history",
    ]);
    expect(activeScreen()?.getAttribute("data-activity")).toBe("history");
  });
});

describe("AppShell — a tab whose repository will not open", () => {
  it("offers retry and close instead of flashing Welcome", async () => {
    mockInvoke("open_repo", () => {
      throw { kind: "InvalidPath", message: "/dev/gone" };
    });
    localStorage.setItem(
      "pg-open-repos",
      JSON.stringify({ paths: ["/dev/gone"], active: "/dev/gone" }),
    );

    render(<App />);

    const panel = await waitFor(() => {
      const el = document.querySelector('[data-testid="tab-loading"]');
      expect(el?.getAttribute("data-failed")).toBe("true");
      return el as Element;
    });
    expect(panel.textContent).toContain("Could not open gone");
    // Welcome must NOT be what a failed tab shows — the tab is still there.
    expect(document.body.textContent).not.toContain("Welcome to PlatypusGit");
    expect(rows()).toHaveLength(1);

    const close = Array.from(panel.querySelectorAll("button")).find(
      (b) => b.textContent === "Close tab",
    );
    await act(async () => {
      fireEvent.click(close as Element);
    });
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(0));
    // With no tabs left, Welcome is right again.
    await waitFor(() =>
      expect(document.body.textContent).toContain("Welcome to PlatypusGit"),
    );
  });
});

// The screens map is keyed by the active repository, so a tab switch unmounts
// the screen. Asserted through a screen that owns local selection state.
describe("AppShell — screen remount on tab switch", () => {
  it("remounts the screen subtree when the active repository changes", async () => {
    seedTwoTabs();
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const before = document.querySelector('[data-activity="history"]');
    await act(async () => {
      fireEvent.click(rows()[1]);
    });
    await waitFor(() =>
      expect(useTabsStore.getState().activePath).toBe("/dev/web"),
    );
    // The activity bar lives inside the keyed subtree, so a fresh node here is
    // proof the screens under it were rebuilt rather than reused.
    expect(document.querySelector('[data-activity="history"]')).not.toBe(before);
  });
});
