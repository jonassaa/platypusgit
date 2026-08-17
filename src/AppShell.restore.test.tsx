// Session restore from `pg-open-repos` (#90), driven through a real <App/> boot.
//
// The other tabs tests seed `useTabsStore` with `setState`, so they never
// exercise MOUNT ORDER — AppShell's restore effect, useCliLaunch's intent, and
// whatever else runs on first paint. That gap is exactly where an e2e failure
// lived: the webview opened a repository (branch chip present) while the strip
// rendered zero tabs, which no store-seeded test could see.
//
// So: write the key, render the app, assert the strip. Nothing is seeded into
// the store here on purpose.

import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import App from "./App";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { emptySlice } from "@/features/repo/repoSlice";
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

/** What e2e's `seedOpenRepos` writes, byte for byte. */
function seedStorage(paths: string[], active: string) {
  localStorage.setItem(
    "pg-recent-repos",
    JSON.stringify(paths.map((p, i) => ({ path: p, openedAt: paths.length - i }))),
  );
  localStorage.setItem(
    "pg-open-repos",
    JSON.stringify({ paths, active }),
  );
}

describe("AppShell — restoring the persisted open set on boot", () => {
  it("renders a tab per persisted repository", async () => {
    seedStorage([API.path, WEB.path], API.path);

    render(<App />);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((r) => r.getAttribute("data-path"))).toEqual([
      API.path,
      WEB.path,
    ]);
  });

  it("opens ONLY the persisted active repository, and marks it active", async () => {
    seedStorage([API.path, WEB.path], WEB.path);

    render(<App />);

    await waitFor(() => expect(rows()).toHaveLength(2));
    // Lazy restore: the inactive tab stays pending, so exactly one open_repo.
    await waitFor(() =>
      expect(useRepoStore.getState().current?.path).toBe(WEB.path),
    );
    const active = rows().filter((r) => r.getAttribute("data-active") === "true");
    expect(active.map((r) => r.getAttribute("data-path"))).toEqual([WEB.path]);
  });

  it("still shows the strip once the repository has finished opening", async () => {
    // The e2e symptom was this pair diverging: a repository open (branch chip
    // on screen) with no tab beside it. Assert them together.
    seedStorage([API.path], API.path);

    render(<App />);

    await waitFor(() =>
      expect(useRepoStore.getState().current?.path).toBe(API.path),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(
      document.querySelector('[data-testid="repo-tab-strip"]'),
    ).not.toBeNull();
  });

  it("survives a boot with no persisted set (Welcome, no strip)", async () => {
    render(<App />);

    await waitFor(() =>
      expect(document.querySelector('[data-testid="repo-tab-strip"]')).toBeNull(),
    );
    expect(rows()).toHaveLength(0);
  });
});
