// "Copy path" / "Copy relative path" on every surface that has a file (#245).
//
// The pair is one helper (`copyPathItems`) reused by the four file-bearing
// menus, so what this pins is: the two entries always sit together, each copies
// what its LABEL says (absolute for "Copy path", workdir-relative for "Copy
// relative path"), and the surfaces where a relative path is meaningless — the
// worktree menu and the repo tab, whose path relative to itself is "" — never
// grow one.
//
// The path arithmetic itself is unit-tested in `src/lib/paths.test.ts`; this is
// about which entry appears where and what it dispatches.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  copyPathItems,
  fileMenuItems,
  multiFileMenuItems,
  worktreeMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { tabMenuItems } from "@/features/repo/RepoTabs";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useTabsStore } from "@/features/repo/useTabsStore";

const copied: string[] = [];

const labels = (items: ContextMenuItem[]) =>
  items.filter((i) => !i.divider && !i.__menuTitle).map((i) => String(i.label));

function item(items: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items.find((i) => String(i.label) === label);
  expect(found, `no menu item labelled ${label}`).toBeDefined();
  return found!;
}

const click = async (items: ContextMenuItem[], label: string) => {
  await item(items, label).onClick?.();
};

function openRepoAt(path: string | null) {
  useRepoStore.setState({
    current: path ? { id: "r1", path, head: "main" } : null,
  } as never);
}

beforeEach(() => {
  copied.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn((t: string) => {
        copied.push(t);
        return Promise.resolve();
      }),
    },
  });
  openRepoAt("/repo");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("copyPathItems", () => {
  it("offers the singular pair for one path", () => {
    expect(labels(copyPathItems(["src/a.txt"]))).toEqual([
      "Copy path",
      "Copy relative path",
    ]);
  });

  it("offers the plural pair for a multi-path selection", () => {
    expect(labels(copyPathItems(["a.txt", "b.txt"]))).toEqual([
      "Copy paths",
      "Copy relative paths",
    ]);
  });

  it("copies the absolute path for 'Copy path'", async () => {
    await click(copyPathItems(["src/a.txt"]), "Copy path");
    expect(copied).toEqual(["/repo/src/a.txt"]);
  });

  it("copies the workdir-relative path for 'Copy relative path'", async () => {
    await click(copyPathItems(["src/a.txt"]), "Copy relative path");
    expect(copied).toEqual(["src/a.txt"]);
  });

  it("uses the workdir's own separator style for the absolute form", async () => {
    openRepoAt("C:\\Users\\me\\repo");
    await click(copyPathItems(["src/a.txt"]), "Copy path");
    expect(copied).toEqual(["C:\\Users\\me\\repo\\src\\a.txt"]);
  });

  it("joins a multi-path copy with newlines, on both entries", async () => {
    const items = copyPathItems(["src/a.txt", "b.txt"]);
    await click(items, "Copy paths");
    await click(items, "Copy relative paths");
    expect(copied).toEqual(["/repo/src/a.txt\n/repo/b.txt", "src/a.txt\nb.txt"]);
  });

  it("disables the absolute entry with no repository open, keeping the relative one", async () => {
    openRepoAt(null);
    const items = copyPathItems(["src/a.txt"]);
    expect(item(items, "Copy path").disabled).toBe(true);
    expect(item(items, "Copy relative path").disabled).toBeFalsy();

    await click(items, "Copy path");
    expect(copied).toEqual([]);
    await click(items, "Copy relative path");
    expect(copied).toEqual(["src/a.txt"]);
  });

  it("disables both entries when there is no path", () => {
    const items = copyPathItems([]);
    expect(item(items, "Copy path").disabled).toBe(true);
    expect(item(items, "Copy relative path").disabled).toBe(true);
  });

  it("copies nothing at all when the path list is empty", async () => {
    const items = copyPathItems([""]);
    await click(items, "Copy path");
    await click(items, "Copy relative path");
    expect(copied).toEqual([]);
  });
});

describe("the file row menu", () => {
  it("offers both entries next to each other", () => {
    const items = fileMenuItems({ path: "src/a.txt" }, "macos");
    const l = labels(items);
    expect(l.indexOf("Copy relative path")).toBe(l.indexOf("Copy path") + 1);
  });

  it("copies absolute and relative from the same row", async () => {
    const items = fileMenuItems({ path: "src/a.txt" }, "macos");
    await click(items, "Copy path");
    await click(items, "Copy relative path");
    expect(copied).toEqual(["/repo/src/a.txt", "src/a.txt"]);
  });

  it("offers both entries on an embedded-repository row", async () => {
    const items = fileMenuItems({ path: "vendor/lib/", embedded: true }, "macos");
    expect(labels(items)).toContain("Copy relative path");
    await click(items, "Copy path");
    await click(items, "Copy relative path");
    // libgit2 reports an embedded repo with a trailing slash (it is gitignore
    // syntax there); neither clipboard form should carry it.
    expect(copied).toEqual(["/repo/vendor/lib", "vendor/lib"]);
  });

  it("has exactly one file-manager entry, addressing the file itself", () => {
    // Reveal (#231) already opens the CONTAINING folder on all three platforms
    // — `open -R` / `explorer /select,` open the parent with the file selected,
    // and Linux xdg-opens the parent. A second "Open containing folder" entry
    // would be a synonym, so there is deliberately only one.
    const items = fileMenuItems({ path: "src/a.txt" }, "linux");
    expect(labels(items).filter((l) => /folder|file manager|Finder|Explorer/i.test(l))).toEqual([
      "Show in file manager",
    ]);
  });
});

describe("the multi-file selection menu", () => {
  it("offers both plural entries", () => {
    const items = multiFileMenuItems({
      stagedPaths: [],
      unstagedPaths: ["src/a.txt", "b.txt"],
    });
    const l = labels(items);
    expect(l.indexOf("Copy relative paths")).toBe(l.indexOf("Copy paths") + 1);
  });

  it("copies every selected path, absolute or relative", async () => {
    const items = multiFileMenuItems({
      stagedPaths: ["staged.txt"],
      unstagedPaths: ["src/a.txt"],
      paths: ["staged.txt", "src/a.txt", "untouched.txt"],
    });
    await click(items, "Copy paths");
    await click(items, "Copy relative paths");
    expect(copied).toEqual([
      "/repo/staged.txt\n/repo/src/a.txt\n/repo/untouched.txt",
      "staged.txt\nsrc/a.txt\nuntouched.txt",
    ]);
  });
});

describe("surfaces with no meaningful relative path", () => {
  it("leaves the worktree menu with only an absolute Copy path", async () => {
    const items = worktreeMenuItems({ name: "wt", path: "/elsewhere/wt" });
    expect(labels(items)).toContain("Copy path");
    expect(labels(items)).not.toContain("Copy relative path");

    await click(items, "Copy path");
    expect(copied).toEqual(["/elsewhere/wt"]);
  });

  it("leaves the repo tab menu with only an absolute Copy path", async () => {
    useTabsStore.setState({
      tabs: [{ path: "/repo-a", repoId: "repo-a-id", status: "open" } as never],
    } as never);
    const items = tabMenuItems("/repo-a", 1, "macos");
    expect(labels(items)).toContain("Copy path");
    expect(labels(items)).not.toContain("Copy relative path");

    await click(items, "Copy path");
    expect(copied).toEqual(["/repo-a"]);
  });
});
