// "Open in external diff tool" on a file row (#235).
//
// The argv, the tool resolution and the console handling are the backend's, and
// `src-tauri/tests/difftool.rs` pins them against a real repository. What only
// this layer can get wrong is WHICH TWO SIDES a row names — and the failure is
// silent: a staged row sent as `worktree` opens the file against the index
// instead of against HEAD, which is a real diff of the wrong thing.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fileMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

const ENTRY = /^Open in external diff tool$/;

const difftoolCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "open_in_difftool");

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
}

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useSettingsStore.getState().reset();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
  } as never);
  mockRefreshAll();
  mockInvoke("open_in_difftool", () => null);
});

afterEach(() => vi.restoreAllMocks());

describe("the external-diff entry on a file row", () => {
  it("sends an unstaged row as the working tree against the index", async () => {
    await labeled(fileMenuItems({ path: "src/a.rs" }), ENTRY).onClick?.();

    expect(difftoolCalls()).toEqual([
      {
        cmd: "open_in_difftool",
        args: {
          repoId: "r1",
          target: { kind: "worktree" },
          paths: ["src/a.rs"],
          tool: null,
        },
      },
    ]);
  });

  it("sends a staged row as the index against HEAD", async () => {
    // The distinction that matters: a staged row's diff is `--cached`. Sent as
    // `worktree` it would open a real diff of the wrong pair, with nothing on
    // screen to say so.
    await labeled(fileMenuItems({ path: "src/a.rs", staged: true }), ENTRY).onClick?.();

    expect(difftoolCalls()[0]?.args).toMatchObject({
      target: { kind: "staged" },
      paths: ["src/a.rs"],
    });
  });

  it("passes the Settings override, trimmed, and nothing when it is blank", async () => {
    useSettingsStore.getState().set("externalDiffTool", "  meld  ");
    await labeled(fileMenuItems({ path: "a" }), ENTRY).onClick?.();
    expect(difftoolCalls()[0]?.args).toMatchObject({ tool: "meld" });

    resetInvokeMock();
    mockRefreshAll();
    mockInvoke("open_in_difftool", () => null);
    // Empty is not an empty `--tool=` — it is "let git decide", which is the
    // case the whole feature is built around.
    useSettingsStore.getState().set("externalDiffTool", "   ");
    await labeled(fileMenuItems({ path: "a" }), ENTRY).onClick?.();
    expect(difftoolCalls()[0]?.args).toMatchObject({ tool: null });
  });

  it("is disabled on an untracked row — git has no diff to hand over", async () => {
    // `git difftool` would run no tool at all for a path in neither side of any
    // diff, so the click would do literally nothing. Disabled says so.
    const item = labeled(fileMenuItems({ path: "new.rs", untracked: true }), ENTRY);
    expect(item.disabled).toBe(true);
    await item.onClick?.();
    expect(difftoolCalls()).toEqual([]);
  });

  it("is enabled once that untracked file is staged", async () => {
    // Then it IS in a diff — the index against HEAD — and `--cached` shows it.
    const item = labeled(
      fileMenuItems({ path: "new.rs", untracked: true, staged: true }),
      ENTRY,
    );
    expect(item.disabled).toBeFalsy();
    await item.onClick?.();
    expect(difftoolCalls()[0]?.args).toMatchObject({ target: { kind: "staged" } });
  });

  it("is disabled, and dispatches nothing, on a row with no path", async () => {
    const item = labeled(fileMenuItems({ path: undefined }), ENTRY);
    expect(item.disabled).toBe(true);
    await item.onClick?.();
    expect(difftoolCalls()).toEqual([]);
  });

  it("is absent from the menus that replace the file menu entirely", () => {
    // A conflicted row gets the conflict menu (its escape hatch is the 3-way
    // merge tool, not a 2-way diff), and a submodule row gets the submodule
    // menu — it has no diff to open at all.
    const conflicted = fileMenuItems({ path: "a", conflicted: true });
    const submodule = fileMenuItems({ path: "vendor/lib", submodule: true });
    for (const items of [conflicted, submodule]) {
      expect(
        items.some((i) => typeof i.label === "string" && ENTRY.test(i.label)),
      ).toBe(false);
    }
  });
});
