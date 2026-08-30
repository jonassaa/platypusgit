// The file rows' context menu on the read-only diff surfaces (#235).
//
// This panel is behind the commit diff screen, History's inline panel, Compare
// and both stash diffs, so one menu here is the entry point on four surfaces.
// Before it, right-clicking a file row in any of them did nothing at all.
//
// The two things only this layer can get wrong:
//   - a rename must pass BOTH paths, or git reports the file as wholly added —
//     the same dead end the feature exists to remove;
//   - a panel with no target must not offer a broken entry (the combined
//     multi-commit diff has no "the" comparison to hand over).
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { DiffToolTarget, FileDiff } from "@/lib/types";

function fileDiff(path: string, oldPath: string | null = null): FileDiff {
  return {
    path,
    oldPath,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1 +1,2 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "add" },
        ],
      },
    ],
  };
}

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
    ...emptySlice(),
    current: { id: "r1", path: "/repo", head: "main" },
  });
  mockRefreshAll();
  mockInvoke("open_in_difftool", () => null);
});

function renderPanel(
  diffs: FileDiff[],
  difftoolTarget: DiffToolTarget | undefined,
  paneIdPrefix: string,
) {
  return render(
    <CommitDiffPanel
      diffs={diffs}
      loading={false}
      error={null}
      header="a → b"
      paneIdPrefix={paneIdPrefix}
      difftoolTarget={difftoolTarget}
    />,
  );
}

function rightClickRow(container: HTMLElement, path: string) {
  const row = container.querySelector(`[data-path="${path}"]`);
  expect(row, `no file row for ${path}`).toBeTruthy();
  fireEvent.contextMenu(row!, { clientX: 10, clientY: 10 });
}

const difftoolArgs = () =>
  getInvokeCalls().find((c) => c.cmd === "open_in_difftool")?.args;

describe("the file-row menu on a read-only diff", () => {
  it("hands the panel's target and the row's path to the diff tool", async () => {
    const { container } = renderPanel(
      [fileDiff("src/a.rs")],
      { kind: "commit", oid: "abc123" },
      "dt1",
    );
    rightClickRow(container, "src/a.rs");

    fireEvent.click(await screen.findByText("Open in external diff tool"));

    await waitFor(() =>
      expect(difftoolArgs()).toMatchObject({
        repoId: "r1",
        target: { kind: "commit", oid: "abc123" },
        paths: ["src/a.rs"],
      }),
    );
  });

  it("passes both sides of a rename, old first", async () => {
    const { container } = renderPanel(
      [fileDiff("src/new.rs", "src/old.rs")],
      { kind: "commit", oid: "abc123" },
      "dt2",
    );
    rightClickRow(container, "src/new.rs");

    fireEvent.click(await screen.findByText("Open in external diff tool"));

    await waitFor(() =>
      expect(difftoolArgs()).toMatchObject({
        paths: ["src/old.rs", "src/new.rs"],
      }),
    );
  });

  it("offers copy-path but no diff-tool entry when the panel has no target", async () => {
    const { container } = renderPanel([fileDiff("src/a.rs")], undefined, "dt3");
    rightClickRow(container, "src/a.rs");

    // The menu still opens — it is the only per-file menu these surfaces have.
    expect(await screen.findByText("Copy path")).toBeTruthy();
    expect(screen.queryByText("Open in external diff tool")).toBeNull();
  });

  it("selects the row it was opened on", async () => {
    // Otherwise the menu acts on a file the user is not looking at — the same
    // surprise a right-click on an unselected row makes anywhere else.
    const { container } = renderPanel(
      [fileDiff("a.rs"), fileDiff("b.rs")],
      { kind: "worktree" },
      "dt4",
    );
    rightClickRow(container, "b.rs");

    await waitFor(() =>
      expect(
        container.querySelector('[data-path="b.rs"]')?.hasAttribute("data-selected"),
      ).toBe(true),
    );
  });
});
