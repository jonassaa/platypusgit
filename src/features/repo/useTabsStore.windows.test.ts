// Per-window tab state (#256). The tab model is unchanged; what is new is that
// a window's open set is ITS open set, and that a tab can leave for a window of
// its own.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { __resetWindowClaims, openReposKey } from "@/features/windows";
import { emptySlice } from "./repoSlice";
import { useRepoStore } from "./useRepoStore";
import { useTabsStore } from "./useTabsStore";

const HANDLES: Record<string, { id: string; path: string; head: string }> = {
  "/dev/api": { id: "r-api", path: "/dev/api", head: "main" },
  "/dev/web": { id: "r-web", path: "/dev/web", head: "trunk" },
};

function armBackend() {
  mockInvoke("open_repo", (args) => {
    const h = HANDLES[args.path as string];
    if (!h) throw { kind: "InvalidPath", message: args.path };
    return h;
  });
  mockInvoke("close_repo", () => undefined);
  mockInvoke("term_close", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("list_all_files", () => []);
  mockInvoke("register_window_repos", () => undefined);
  mockInvoke("next_window_label", () => "pg-1");
}

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  armBackend();
  // Which labels this webview has already handed out is module state, exactly
  // like the resolver's attribution — a leak between tests would make the
  // second one silently assert on `pg-2`.
  __resetWindowClaims();
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
  useRepoStore.setState(emptySlice());
});

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("the backend registry stays in step with the strip", () => {
  it("registers this window's repositories on every persist", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    const last = calls("register_window_repos").at(-1);
    // Both id and path: the id is what an eviction needs, the path is what
    // routing a `pgit <path>` compares against.
    expect(last?.args.repos).toEqual([
      { id: "r-api", path: "/dev/api" },
      { id: "r-web", path: "/dev/web" },
    ]);
  });

  it("registers a still-pending tab too, so routing works before it opens", async () => {
    useTabsStore.setState({ tabs: [{ ...newPending("/dev/web") }] });
    await useTabsStore.getState().openRepo("/dev/api");
    const last = calls("register_window_repos").at(-1);
    expect(last?.args.repos).toContainEqual({ id: null, path: "/dev/web" });
  });

  it("a registry write that fails never fails the tab switch", async () => {
    mockInvoke("register_window_repos", () => {
      throw { kind: "Internal", message: "no" };
    });
    await useTabsStore.getState().openRepo("/dev/api");
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
  });
});

function newPending(path: string) {
  return {
    path,
    repoId: null,
    status: "pending" as const,
    screen: "history",
    slice: null,
    dirty: 0,
    conflicts: 0,
  };
}

describe("opening a repository in a new window", () => {
  it("seeds the new window's own storage key and keeps this window's tab", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openInNewWindow("/dev/api");

    // Seeded through STORAGE, before the window exists — see openAppWindow.
    expect(JSON.parse(localStorage.getItem(openReposKey("pg-1")) as string)).toEqual({
      paths: ["/dev/api"],
      active: "/dev/api",
    });
    // "Open in" a new window, not "move to" one.
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
  });

  it("records the new window so a launch after a quit brings it back", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openInNewWindow("/dev/api");
    expect(JSON.parse(localStorage.getItem("pg-windows") as string)).toEqual([
      { label: "pg-1", bounds: { x: 32, y: 32, width: 1200, height: 800 } },
    ]);
  });
});

describe("moving a repository to a new window", () => {
  it("seeds the new window and closes the tab here", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    await useTabsStore.getState().moveTabToNewWindow("/dev/web");

    expect(JSON.parse(localStorage.getItem(openReposKey("pg-1")) as string)).toEqual({
      paths: ["/dev/web"],
      active: "/dev/web",
    });
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
    // The tab left, so its repository is evicted here — the new window opens
    // its OWN RepoId for the same path.
    expect(calls("close_repo").map((c) => c.args.repoId)).toContain("r-web");
  });

  it("keeps the tab when the window could not be created", async () => {
    mockInvoke("next_window_label", () => {
      throw { kind: "Internal", message: "no label" };
    });
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    await useTabsStore.getState().moveTabToNewWindow("/dev/web");

    // The one place in this store where a failure could take work away rather
    // than leave it where it was.
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      "/dev/api",
      "/dev/web",
    ]);
  });

  it("does nothing for a tab that is not open here", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().moveTabToNewWindow("/dev/nowhere");
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
    expect(localStorage.getItem(openReposKey("pg-1"))).toBeNull();
  });
});

describe("a sibling window", () => {
  it("persists and restores under its OWN key, leaving main's session alone", async () => {
    // The store reads its label once, at creation, so a sibling needs a fresh
    // module graph with a different window mock.
    vi.resetModules();
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        label: "pg-1",
        outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
        outerSize: vi.fn().mockResolvedValue({ width: 1200, height: 800 }),
        setTitle: vi.fn().mockResolvedValue(undefined),
        show: vi.fn().mockResolvedValue(undefined),
        theme: vi.fn().mockResolvedValue(null),
        onThemeChanged: vi.fn().mockResolvedValue(() => {}),
      }),
    }));
    localStorage.setItem(
      "pg-open-repos",
      JSON.stringify({ paths: ["/dev/api"], active: "/dev/api" }),
    );
    localStorage.setItem(
      "pg-open-repos:pg-1",
      JSON.stringify({ paths: ["/dev/web"], active: "/dev/web" }),
    );

    const sibling = await import("./useTabsStore");
    await sibling.useTabsStore.getState().restoreSession();

    expect(sibling.useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
    // main's set is untouched by a sibling's writes.
    expect(JSON.parse(localStorage.getItem("pg-open-repos") as string)).toEqual({
      paths: ["/dev/api"],
      active: "/dev/api",
    });
    expect(JSON.parse(localStorage.getItem("pg-open-repos:pg-1") as string)).toEqual({
      paths: ["/dev/web"],
      active: "/dev/web",
    });
    vi.doUnmock("@tauri-apps/api/window");
    vi.resetModules();
  });
});
