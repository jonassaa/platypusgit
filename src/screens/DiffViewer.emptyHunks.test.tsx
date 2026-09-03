// The DiffViewer's half of the zero-hunk empty state.
//
// Same condition as `features/diff/CommitDiffPanel.emptyHunks.test.tsx` and the
// same sentence: a textual diff whose `hunks` is empty — an empty added file, or
// a mode-only `chmod +x`, which git prints as `old mode`/`new mode` with no `@@`
// range at all. The row shows `0 / 0` and this pane used to show nothing.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiffViewerScreen } from "./DiffViewer";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileDiff, FileStatus } from "@/lib/types";

const modified = (path: string): FileStatus =>
  ({
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  }) as unknown as FileStatus;

const noHunks = (path: string): FileDiff => ({
  path,
  oldPath: null,
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
});

function setup(diff: FileDiff) {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [modified(diff.path)],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_status", () => [modified(diff.path)]);
  mockInvoke("get_diff", () => diff);
  mockInvoke("read_file_content", () => null);
  mockInvoke("read_file_content_at_rev", () => null);
  mockInvoke("read_image_preview", () => null);
}

describe("DiffViewer, a file with no hunks", () => {
  beforeEach(() => resetInvokeMock());

  it("explains the empty pane instead of rendering nothing", async () => {
    setup(noHunks("scripts/build.sh"));
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );

    // Queried fresh inside the wait, never held across one: the syntax reads
    // resolve and re-render this pane, so a node `findByText` handed back can be
    // detached by the time the assertion reads it (the CI-only failure
    // `DiffViewer.imagepreview.test.tsx` documents at length).
    await waitFor(() =>
      expect(screen.getByText("No diff")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("File is tracked but no hunks were produced."),
    ).toBeInTheDocument();
  });

  it("keeps the binary notice for a binary file, rather than this one", async () => {
    setup({ ...noHunks("doc.pdf"), binary: true });
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );

    // Both conditions inside ONE `waitFor`, and neither is optional — the same
    // shape, for the same reasons, as `DiffViewer.imagepreview.test.tsx`.
    //
    // The count alone is the wrong signal: `getInvokeCalls()` records a call
    // when it is DISPATCHED, so "both reads issued" is not "both results
    // rendered", and a separate assertion after it reads the pane mid-swap
    // under CI load. The DOM alone is wrong in the other direction: this pane
    // renders `title="Binary file"` WHILE the previews load, so waiting on that
    // text alone passes before either read has landed.
    await waitFor(() => {
      expect(
        getInvokeCalls().filter((c) => c.cmd === "read_image_preview").length,
      ).toBe(2);
      expect(screen.getByText("Binary file")).toBeInTheDocument();
      expect(screen.queryByText("No diff")).toBeNull();
    });
  });
});
