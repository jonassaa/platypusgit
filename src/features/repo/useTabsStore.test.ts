// The tab store's invariants (#90). The interesting ones are all about NOT
// leaking: a switch must replace the whole slice, an in-flight refresh from the
// repository you left must not land in the one you arrived at, and a failed open
// must leave the tab you were on intact.

import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { REPO_SLICE_KEYS, emptySlice } from "./repoSlice";
import { OPEN_REPOS_KEY } from "./tabs";
import { useRepoStore } from "./useRepoStore";
import { useTabsStore } from "./useTabsStore";

const HANDLES: Record<string, { id: string; path: string; head: string }> = {
  "/dev/api": { id: "r-api", path: "/dev/api", head: "main" },
  "/dev/web": { id: "r-web", path: "/dev/web", head: "trunk" },
};

/** One status entry per repo, so a leak between them is visible. */
const STATUS: Record<string, unknown[]> = {
  "r-api": [
    {
      path: "api-only.txt",
      worktree: { kind: "Modified" },
      index: { kind: "Unmodified" },
    },
  ],
  "r-web": [],
};

function armBackend() {
  mockInvoke("open_repo", (args) => {
    const h = HANDLES[args.path as string];
    if (!h) throw { kind: "InvalidPath", message: args.path };
    return h;
  });
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_status", (args) => STATUS[args.repoId as string] ?? []);
  mockInvoke("list_branches", (args) => [
    {
      name: args.repoId === "r-api" ? "main" : "trunk",
      isHead: true,
      isRemote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      tip: "0".repeat(40),
    },
  ]);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", (args) => ({
    commits: [
      {
        oid: `${args.repoId}-c1`,
        shortOid: "abc1234",
        summary: `commit in ${args.repoId}`,
        author: "a",
        email: "a@b.c",
        timestamp: 1,
        parents: [],
        refs: [],
      },
    ],
    nextCursor: null,
  }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("list_all_files", () => []);
}

function resetStores() {
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
  useRepoStore.setState(emptySlice());
}

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  armBackend();
  resetStores();
});

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("useTabsStore — opening", () => {
  it("opens a repository into a tab and makes it active", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    const { tabs, activePath } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      path: "/dev/api",
      repoId: "r-api",
      status: "open",
      screen: "history",
    });
    expect(activePath).toBe("/dev/api");
    expect(useRepoStore.getState().current?.id).toBe("r-api");
  });

  it("opening an already-open path focuses its tab instead of duplicating it", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    expect(useTabsStore.getState().activePath).toBe("/dev/web");

    await useTabsStore.getState().openRepo("/dev/api");
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      "/dev/api",
      "/dev/web",
    ]);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
  });

  it("a failed open leaves the tab you were on, with its data", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    const before = useRepoStore.getState().commits;

    await useTabsStore.getState().openRepo("/dev/missing");

    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
    expect(useRepoStore.getState().current?.id).toBe("r-api");
    expect(useRepoStore.getState().commits).toEqual(before);
    expect(useRepoStore.getState().error?.kind).toBe("InvalidPath");
  });
});

describe("useTabsStore — concurrent opens", () => {
  it("opens the repository ONCE when two requests race for the same tab", async () => {
    let release = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    mockInvoke("open_repo", async (args) => {
      await gate;
      return HANDLES[args.path as string];
    });

    const first = useTabsStore.getState().openRepo("/dev/api");
    const second = useTabsStore.getState().openRepo("/dev/api");
    release();
    await Promise.all([first, second]);

    // Two `open_repo` calls would mean two RepoIds for one repository, one of
    // them never evicted.
    expect(calls("open_repo")).toHaveLength(1);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useRepoStore.getState().current?.id).toBe("r-api");
  });

  it("evicts the handle of an open that was superseded mid-flight", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    // Leave /dev/web and re-enter it, but supersede that open before it lands.
    await useTabsStore.getState().activate("/dev/api");
    useTabsStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === "/dev/web" ? { ...t, status: "pending", slice: null } : t,
      ),
    }));

    let release = () => {};
    mockInvoke("open_repo", async (args) => {
      if (args.path === "/dev/web") {
        await new Promise<void>((res) => {
          release = res;
        });
      }
      return HANDLES[args.path as string];
    });

    const pending = useTabsStore.getState().activate("/dev/web");
    // Supersede it: bumping the activation counter is what a real switch does.
    await useTabsStore.getState().activate("/dev/api");
    release();
    await pending;

    // The abandoned handle must be closed — `open` never evicts on its own.
    expect(calls("close_repo").map((c) => c.args.repoId)).toContain("r-web");
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
  });
});

describe("useTabsStore — switching", () => {
  it("hydrates the incoming slice and leaves nothing of the outgoing one", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    // Every per-repo field now belongs to /dev/web.
    const s = useRepoStore.getState();
    expect(s.current?.id).toBe("r-web");
    expect(s.status).toEqual([]);
    expect(s.commits[0].oid).toBe("r-web-c1");
    expect(s.branches[0].name).toBe("trunk");

    // Going back restores the other repo's, not a blend of the two.
    await useTabsStore.getState().activate("/dev/api");
    const a = useRepoStore.getState();
    expect(a.current?.id).toBe("r-api");
    expect(a.commits[0].oid).toBe("r-api-c1");
    expect(a.branches[0].name).toBe("main");
    expect(a.status).toHaveLength(1);
  });

  it("snapshots every slice key on the way out", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    const frozen = useTabsStore.getState().tabs[0].slice;
    expect(frozen).not.toBeNull();
    expect(Object.keys(frozen as object).sort()).toEqual(
      [...REPO_SLICE_KEYS].sort(),
    );
  });

  it("caches badge counts for the inactive tab", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    expect(useTabsStore.getState().tabs[0].dirty).toBe(1);
    expect(useTabsStore.getState().tabs[0].conflicts).toBe(0);
  });

  it("drops a refresh that resolved after the user moved to another repo", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    // Start a refresh for the repo we are NOT on any more, resolving late.
    let release = () => {};
    mockInvoke("get_status", (args) => {
      if (args.repoId !== "r-api") return STATUS[args.repoId as string] ?? [];
      return new Promise<unknown[]>((res) => {
        release = () => res(STATUS["r-api"]);
      });
    });
    useRepoStore.setState({ current: HANDLES["/dev/api"] as never });
    const pending = useRepoStore.getState().refreshAll();
    // …and switch back to /dev/web before it lands.
    useRepoStore.setState({ current: HANDLES["/dev/web"] as never, status: [] });
    release();
    await pending;

    // r-api's status must NOT have been written over r-web's.
    expect(useRepoStore.getState().current?.id).toBe("r-web");
    expect(useRepoStore.getState().status).toEqual([]);
  });

  it("remembers each tab's screen without persisting it", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    useTabsStore.getState().rememberScreen("branches");
    await useTabsStore.getState().openRepo("/dev/web");
    expect(useTabsStore.getState().activeScreen()).toBe("history");

    await useTabsStore.getState().activate("/dev/api");
    expect(useTabsStore.getState().activeScreen()).toBe("branches");
    // pg-screen stays dead: the persisted set carries paths only.
    expect(JSON.parse(localStorage.getItem(OPEN_REPOS_KEY) as string)).toEqual({
      paths: ["/dev/api", "/dev/web"],
      active: "/dev/api",
    });
  });

  it("steps between tabs, wrapping", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    await useTabsStore.getState().step(1);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
    await useTabsStore.getState().step(-1);
    expect(useTabsStore.getState().activePath).toBe("/dev/web");
  });

  it("selectIndex is 1-based and ignores out-of-range numbers", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    await useTabsStore.getState().selectIndex(1);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
    await useTabsStore.getState().selectIndex(9);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
  });
});

describe("useTabsStore — closing", () => {
  it("evicts the repository backend-side and activates a neighbour", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    await useTabsStore.getState().close("/dev/web");

    expect(calls("close_repo").map((c) => c.args.repoId)).toEqual(["r-web"]);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
    expect(useTabsStore.getState().activePath).toBe("/dev/api");
    expect(useRepoStore.getState().current?.id).toBe("r-api");
  });

  it("closing an inactive tab leaves the active one alone", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");

    await useTabsStore.getState().close("/dev/api");

    expect(useTabsStore.getState().activePath).toBe("/dev/web");
    expect(useRepoStore.getState().current?.id).toBe("r-web");
  });

  it("closing the last tab returns to Welcome with an empty slice", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().close("/dev/api");

    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useTabsStore.getState().activePath).toBeNull();
    expect(useRepoStore.getState().current).toBeNull();
    expect(useRepoStore.getState().commits).toEqual([]);
    expect(loadPersisted()).toEqual({ paths: [], active: null });
  });

  it("closeOthers keeps exactly one tab", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    await useTabsStore.getState().closeOthers("/dev/web");
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/web"]);
    expect(useTabsStore.getState().activePath).toBe("/dev/web");
  });

  it("closeAll empties the strip", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    await useTabsStore.getState().closeAll();
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useRepoStore.getState().current).toBeNull();
  });
});

describe("useTabsStore — session restore", () => {
  it("creates every persisted tab but opens only the active one", async () => {
    localStorage.setItem(
      OPEN_REPOS_KEY,
      JSON.stringify({ paths: ["/dev/api", "/dev/web"], active: "/dev/web" }),
    );

    await useTabsStore.getState().restoreSession();

    const { tabs, activePath } = useTabsStore.getState();
    expect(tabs.map((t) => t.path)).toEqual(["/dev/api", "/dev/web"]);
    expect(activePath).toBe("/dev/web");
    // Lazy: five persisted repositories must cost ONE open at launch.
    expect(calls("open_repo").map((c) => c.args.path)).toEqual(["/dev/web"]);
    expect(tabs[0].status).toBe("pending");
    expect(tabs[1].status).toBe("open");
  });

  it("opens a pending tab on first activation", async () => {
    localStorage.setItem(
      OPEN_REPOS_KEY,
      JSON.stringify({ paths: ["/dev/api", "/dev/web"], active: "/dev/web" }),
    );
    await useTabsStore.getState().restoreSession();
    await useTabsStore.getState().activate("/dev/api");
    expect(useRepoStore.getState().current?.id).toBe("r-api");
    expect(useTabsStore.getState().tabs[0].status).toBe("open");
  });

  it("marks a vanished path failed rather than crashing the launch", async () => {
    localStorage.setItem(
      OPEN_REPOS_KEY,
      JSON.stringify({ paths: ["/dev/gone"], active: "/dev/gone" }),
    );
    await useTabsStore.getState().restoreSession();
    expect(useTabsStore.getState().tabs[0].status).toBe("failed");
    expect(useRepoStore.getState().error?.kind).toBe("InvalidPath");
  });

  it("is a no-op once tabs exist (a second mount must not duplicate them)", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    const before = useTabsStore.getState().tabs;
    await useTabsStore.getState().restoreSession();
    expect(useTabsStore.getState().tabs).toBe(before);
  });
});

describe("useTabsStore — badges", () => {
  it("re-reads status for open inactive tabs only", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    // Something changed in the background repo while we were away.
    mockInvoke("get_status", (args) =>
      args.repoId === "r-api"
        ? [
            { path: "a", worktree: { kind: "Modified" }, index: { kind: "Unmodified" } },
            { path: "b", worktree: { kind: "Unmodified" }, index: { kind: "Added" } },
          ]
        : [],
    );

    await useTabsStore.getState().refreshBadges();

    expect(useTabsStore.getState().tabs[0].dirty).toBe(2);
    // The active tab is refreshed by the repo store, not by the badge sweep.
    expect(useTabsStore.getState().tabs[1].dirty).toBe(0);
  });

  it("swallows a failing badge read", async () => {
    await useTabsStore.getState().openRepo("/dev/api");
    await useTabsStore.getState().openRepo("/dev/web");
    mockInvoke("get_status", (args) => {
      if (args.repoId === "r-api") throw new Error("boom");
      return [];
    });
    await expect(useTabsStore.getState().refreshBadges()).resolves.toBeUndefined();
    expect(useRepoStore.getState().error).toBeNull();
  });
});

function loadPersisted() {
  return JSON.parse(localStorage.getItem(OPEN_REPOS_KEY) as string);
}
