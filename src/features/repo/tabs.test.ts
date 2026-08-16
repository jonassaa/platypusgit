import { beforeEach, describe, expect, it } from "vitest";

import {
  OPEN_REPOS_KEY,
  closeNeighbour,
  cycle,
  labelTabs,
  loadOpenRepos,
  newTab,
  patchTab,
  removeTab,
  repoDisplayName,
  saveOpenRepos,
  upsertTab,
  type RepoTab,
} from "./tabs";

const t = (path: string, over: Partial<RepoTab> = {}) => newTab(path, over);

describe("tabs — list reducers", () => {
  it("newTab starts pending, on History, with no slice", () => {
    const tab = t("/a/api");
    expect(tab.status).toBe("pending");
    // Launch always lands on History — a restored tab is no exception.
    expect(tab.screen).toBe("history");
    expect(tab.slice).toBeNull();
    expect(tab.repoId).toBeNull();
  });

  it("upsert dedupes by path and keeps position", () => {
    let tabs = [t("/a"), t("/b"), t("/c")];
    tabs = upsertTab(tabs, t("/b", { repoId: "r2", status: "open" }));
    expect(tabs.map((x) => x.path)).toEqual(["/a", "/b", "/c"]);
    expect(tabs[1].repoId).toBe("r2");
    expect(tabs[1].status).toBe("open");
  });

  it("upsert appends an unseen path", () => {
    const tabs = upsertTab([t("/a")], t("/b"));
    expect(tabs.map((x) => x.path)).toEqual(["/a", "/b"]);
  });

  it("patchTab is a no-op for an unknown path", () => {
    const tabs = [t("/a")];
    expect(patchTab(tabs, "/nope", { dirty: 3 })).toBe(tabs);
  });

  it("removeTab drops only the named path", () => {
    expect(removeTab([t("/a"), t("/b")], "/a").map((x) => x.path)).toEqual(["/b"]);
  });

  describe("closeNeighbour", () => {
    it("takes the tab to the right", () => {
      // closed index 0 of [a,b,c] → remaining [b,c] → b
      expect(closeNeighbour([t("/b"), t("/c")], 0)?.path).toBe("/b");
    });
    it("falls back to the left at the end of the strip", () => {
      // closed index 2 of [a,b,c] → remaining [a,b] → b
      expect(closeNeighbour([t("/a"), t("/b")], 2)?.path).toBe("/b");
    });
    it("is null when nothing remains", () => {
      expect(closeNeighbour([], 0)).toBeNull();
    });
  });

  describe("cycle", () => {
    const tabs = [t("/a"), t("/b"), t("/c")];
    it("steps forward and wraps", () => {
      expect(cycle(tabs, "/a", 1)).toBe("/b");
      expect(cycle(tabs, "/c", 1)).toBe("/a");
    });
    it("steps back and wraps", () => {
      expect(cycle(tabs, "/b", -1)).toBe("/a");
      expect(cycle(tabs, "/a", -1)).toBe("/c");
    });
    it("lands on the first tab when nothing is active", () => {
      expect(cycle(tabs, null, 1)).toBe("/a");
    });
    it("is null with no tabs", () => {
      expect(cycle([], null, 1)).toBeNull();
    });
  });
});

describe("tabs — labelling", () => {
  it("names a repo by its last path segment, separator-agnostic", () => {
    expect(repoDisplayName("/home/me/dev/api")).toBe("api");
    expect(repoDisplayName("/home/me/dev/api/")).toBe("api");
    expect(repoDisplayName("C:\\dev\\api")).toBe("api");
    expect(repoDisplayName("api")).toBe("api");
  });

  it("leaves unique names bare", () => {
    expect(labelTabs([t("/dev/api"), t("/dev/web")])).toEqual(["api", "web"]);
  });

  it("prefixes the parent dir ONLY for colliding names", () => {
    expect(
      labelTabs([t("/work/acme/api"), t("/work/beta/api"), t("/work/acme/web")]),
    ).toEqual(["acme/api", "beta/api", "web"]);
  });

  it("survives a collision at the filesystem root", () => {
    expect(labelTabs([t("/api"), t("/x/api")])).toEqual(["api", "x/api"]);
  });
});

describe("tabs — pg-open-repos persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the open set and the active path", () => {
    saveOpenRepos([t("/a"), t("/b")], "/b");
    expect(loadOpenRepos()).toEqual({ paths: ["/a", "/b"], active: "/b" });
  });

  it("is empty with nothing stored", () => {
    expect(loadOpenRepos()).toEqual({ paths: [], active: null });
  });

  it("tolerates garbage", () => {
    localStorage.setItem(OPEN_REPOS_KEY, "not json");
    expect(loadOpenRepos()).toEqual({ paths: [], active: null });
    localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify([1, 2, 3]));
    expect(loadOpenRepos()).toEqual({ paths: [], active: null });
    localStorage.setItem(
      OPEN_REPOS_KEY,
      JSON.stringify({ paths: ["/a", 7, null, "/a"], active: 9 }),
    );
    // Non-strings and duplicates dropped; a bogus active falls back to the first.
    expect(loadOpenRepos()).toEqual({ paths: ["/a"], active: "/a" });
  });

  it("falls back to the first path when active is not in the set", () => {
    localStorage.setItem(
      OPEN_REPOS_KEY,
      JSON.stringify({ paths: ["/a", "/b"], active: "/gone" }),
    );
    expect(loadOpenRepos().active).toBe("/a");
  });

  it("caps the persisted set so a runaway value can't slow startup", () => {
    const many = Array.from({ length: 40 }, (_, i) => t(`/r${i}`));
    saveOpenRepos(many, "/r39");
    const loaded = loadOpenRepos();
    expect(loaded.paths).toHaveLength(20);
    // /r39 fell outside the cap, so active follows the surviving head.
    expect(loaded.active).toBe("/r0");
  });

  it("writes null for an active path that is not open", () => {
    saveOpenRepos([], "/a");
    expect(loadOpenRepos()).toEqual({ paths: [], active: null });
  });
});
