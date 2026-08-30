// `useRepoStore.openInDifftool` (#235).
//
// The action is short, and every line of it is there for a reason that is easy
// to delete by accident:
//
// - the activity entry, because `git difftool` resolves when the TOOL exits and
//   a person reading a diff in Beyond Compare takes minutes — without it, the
//   click looks swallowed;
// - the `finally` that clears it, because a failed tool must not leave a status
//   line up forever;
// - the refresh, because a working-tree side is handed to the tool as the REAL
//   file, so edits land in the worktree;
// - refresh BEFORE the error, because `refreshAll` clears `error` as its first
//   act and React batches same-tick sets.

import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";

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

const statusReads = () =>
  getInvokeCalls().filter((c) => c.cmd === "get_status").length;

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useSettingsStore.getState().reset();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "r1", path: "/repo", head: "main" },
  });
  mockRefreshAll();
});

describe("openInDifftool", () => {
  it("holds a difftool activity entry until the tool exits", async () => {
    let seen: string | undefined;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockInvoke("open_in_difftool", async () => {
      seen = useRepoStore.getState().activity.difftool?.label;
      await gate;
      return null;
    });

    const running = useRepoStore
      .getState()
      .openInDifftool({ kind: "worktree" }, ["src/a.rs"]);
    // Still open — this is the whole point of the entry.
    await Promise.resolve();
    expect(useRepoStore.getState().activity.difftool).toBeTruthy();
    release!();
    await running;

    expect(seen).toContain("src/a.rs");
    expect(useRepoStore.getState().activity.difftool).toBeUndefined();
  });

  it("clears the entry when the tool fails, and reports the failure", async () => {
    mockInvoke("open_in_difftool", () => {
      throw { kind: "Git", message: "no known diff tool is available" };
    });

    await useRepoStore.getState().openInDifftool({ kind: "worktree" }, ["a"]);

    expect(useRepoStore.getState().activity.difftool).toBeUndefined();
    // Refresh-then-error: the opposite order wipes the banner, because
    // `refreshAll` starts with `set({ error: null })`.
    expect(useRepoStore.getState().error).toMatchObject({ kind: "Git" });
    expect(statusReads()).toBe(1);
  });

  it("refreshes afterwards — the tool may have written the working-tree side", async () => {
    mockInvoke("open_in_difftool", () => null);
    await useRepoStore.getState().openInDifftool({ kind: "worktree" }, ["a"]);
    expect(statusReads()).toBe(1);
  });

  it("passes the target and paths through untouched", async () => {
    mockInvoke("open_in_difftool", () => null);
    await useRepoStore
      .getState()
      .openInDifftool({ kind: "commit", oid: "abc123" }, ["old.rs", "new.rs"]);

    expect(getInvokeCalls().find((c) => c.cmd === "open_in_difftool")?.args).toEqual({
      repoId: "r1",
      target: { kind: "commit", oid: "abc123" },
      paths: ["old.rs", "new.rs"],
      tool: null,
    });
  });

  it("does nothing without a repository or without a path", async () => {
    mockInvoke("open_in_difftool", () => null);
    await useRepoStore.getState().openInDifftool({ kind: "worktree" }, []);
    useRepoStore.setState({ current: null });
    await useRepoStore.getState().openInDifftool({ kind: "worktree" }, ["a"]);

    expect(getInvokeCalls().filter((c) => c.cmd === "open_in_difftool")).toEqual([]);
  });
});
