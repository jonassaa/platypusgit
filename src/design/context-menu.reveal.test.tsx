// "Reveal in Finder/Explorer" and "Open in terminal" (#215): the file-row menu
// and the repo tab's menu both offer them, next to "Copy path", and both wire
// straight to the typed `lib/tauri.ts` wrappers rather than calling `invoke`
// themselves. See `src-tauri/src/reveal.rs` for the platform argv builders —
// this only tests that the menu ITEMS exist and dispatch correctly.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fileMenuItems, type ContextMenuItem } from "./context-menu";
import { tabMenuItems } from "@/features/repo/RepoTabs";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
  } as never);
  mockInvoke("reveal_in_file_manager", () => null);
  mockInvoke("open_in_terminal", () => null);
});

afterEach(() => vi.restoreAllMocks());

describe("fileMenuItems reveal/terminal", () => {
  it("labels the reveal entry per platform", () => {
    expect(labeled(fileMenuItems({ path: "a.txt" }, "macos"), /^Reveal in Finder$/)).toBeTruthy();
    expect(
      labeled(fileMenuItems({ path: "a.txt" }, "windows"), /^Show in Explorer$/),
    ).toBeTruthy();
    expect(
      labeled(fileMenuItems({ path: "a.txt" }, "linux"), /^Show in file manager$/),
    ).toBeTruthy();
    expect(
      labeled(fileMenuItems({ path: "a.txt" }, undefined), /^Show in file manager$/),
    ).toBeTruthy();
  });

  it("reveals the file through the active repo's id and the file's path", () => {
    labeled(fileMenuItems({ path: "src/a.txt" }, "macos"), /^Reveal in Finder$/).onClick?.();

    expect(calls("reveal_in_file_manager")).toEqual([
      { cmd: "reveal_in_file_manager", args: { repoId: "r1", relativePath: "src/a.txt" } },
    ]);
  });

  it("opens a terminal through the active repo's id and the file's path", () => {
    labeled(fileMenuItems({ path: "src/a.txt" }, "macos"), /^Open in terminal$/).onClick?.();

    expect(calls("open_in_terminal")).toEqual([
      { cmd: "open_in_terminal", args: { repoId: "r1", relativePath: "src/a.txt" } },
    ]);
  });

  it("does nothing when the row has no path", () => {
    labeled(fileMenuItems({ path: undefined }, "macos"), /^Reveal in Finder$/).onClick?.();
    labeled(fileMenuItems({ path: undefined }, "macos"), /^Open in terminal$/).onClick?.();

    expect(calls("reveal_in_file_manager")).toEqual([]);
    expect(calls("open_in_terminal")).toEqual([]);
  });
});

describe("tabMenuItems reveal/terminal", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [
        { path: "/repo-a", repoId: "repo-a-id", status: "open" } as never,
        { path: "/repo-b", repoId: null, status: "pending" } as never,
      ],
    } as never);
  });

  it("reveals and opens a terminal at the repo root, with no relative path", () => {
    labeled(tabMenuItems("/repo-a", 2, "windows"), /^Show in Explorer$/).onClick?.();
    labeled(tabMenuItems("/repo-a", 2, "windows"), /^Open in terminal$/).onClick?.();

    expect(calls("reveal_in_file_manager")).toEqual([
      { cmd: "reveal_in_file_manager", args: { repoId: "repo-a-id", relativePath: undefined } },
    ]);
    expect(calls("open_in_terminal")).toEqual([
      { cmd: "open_in_terminal", args: { repoId: "repo-a-id", relativePath: undefined } },
    ]);
  });

  it("disables both entries for a tab with no repoId yet", () => {
    const items = tabMenuItems("/repo-b", 2, "windows");
    expect(labeled(items, /^Show in Explorer$/).disabled).toBe(true);
    expect(labeled(items, /^Open in terminal$/).disabled).toBe(true);
  });
});
