// Line-level staging from the CommitPanel diff (#61 D7).
//
// `selected` holds indices among the hunk's CHANGED (+/-) lines, counted from
// 0 — not indices into hunk.lines, which also carries context and header rows.
// These tests pin that numbering end-to-end: a context line before the
// additions must not shift the indices sent to the backend.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 3,
  deletions: 0,
  embedded: false,
});

/** One hunk: a leading context line then three additions → changed 0,1,2. */
const diffWithThreeAdditions = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,1 +1,4 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "base\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "add1\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 3, content: "add2\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 4, content: "add3\n" },
      ],
    },
  ],
});

/** The hunk button's label, which is how a line selection becomes observable. */
const selCountLabel = () => screen.getByTestId("hunk-stage").textContent ?? "";

const stageLinesCall = () =>
  [...getInvokeCalls()].reverse().find((c) => c.cmd === "stage_lines");
const stageHunkCall = () =>
  [...getInvokeCalls()].reverse().find((c) => c.cmd === "stage_hunk");

function setup() {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", (args) => diffWithThreeAdditions(args.path as string));
  mockInvoke("get_status", () => [unstaged("a.ts")]);
  mockInvoke("stage_lines", () => undefined);
  mockInvoke("stage_hunk", () => undefined);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
}

describe("CommitPanel line-level staging (#61 D7)", () => {
  beforeEach(setup);

  it("stages only the clicked line, numbered among changed lines", async () => {
    const rows = await screen.findAllByTestId("diff-line-changed");
    expect(rows).toHaveLength(3); // the context line is not selectable

    fireEvent.click(rows[1]); // second addition → changed index 1
    // Wait for the selection to be observable before acting on it. The selection
    // deliberately clears whenever `diff` changes, and the mount's diff fetch can
    // still settle here; clicking Stage in the same tick then finds an empty
    // selection and falls back to stage_hunk, so stage_lines is never called.
    // Same reason the toggle-off case below waits between its two clicks.
    await waitFor(() => expect(selCountLabel()).toMatch(/1 line/i));
    fireEvent.click(screen.getByTestId("hunk-stage"));

    await waitFor(() =>
      expect(stageLinesCall()?.args).toMatchObject({
        path: "a.ts",
        hunkIndex: 0,
        selected: [1],
      }),
    );
  });

  it("shows the selection count on the stage button", async () => {
    const rows = await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(rows[0]);
    await waitFor(() => expect(selCountLabel()).toMatch(/1 line/i));
    fireEvent.click(screen.getAllByTestId("diff-line-changed")[2]);
    await waitFor(() => expect(selCountLabel()).toMatch(/2 lines/i));
  });

  it("extends a range on shift-click", async () => {
    const rows = await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(rows[0]);
    // Waiting for the anchor click to land, for the same reason the toggle-off
    // case below does: the selection deliberately clears when `diff` changes, and
    // firing both clicks synchronously lets a pending refresh land between them —
    // the shift-click then finds no anchor and reads as a plain click on row 2.
    // It passed by luck until a render-timing change made it fail ~1 run in 3.
    await waitFor(() =>
      expect(screen.getByTestId("hunk-stage").textContent).toMatch(/1 line/i),
    );
    fireEvent.click(screen.getAllByTestId("diff-line-changed")[2], {
      shiftKey: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("hunk-stage").textContent).toMatch(/3 lines/i),
    );
    fireEvent.click(screen.getByTestId("hunk-stage"));

    await waitFor(() =>
      expect(stageLinesCall()?.args).toMatchObject({ selected: [0, 1, 2] }),
    );
  });

  it("toggles a line off when clicked twice", async () => {
    const rows = await screen.findAllByTestId("diff-line-changed");

    // Waiting for the selected state between the clicks, rather than firing both
    // synchronously: the selection deliberately clears when `diff` changes, so a
    // second click landing before the diff settles would re-select instead of
    // toggling off, and the assertion would race.
    fireEvent.click(rows[1]);
    await waitFor(() =>
      expect(screen.getByTestId("hunk-stage").textContent).toMatch(/1 line/i),
    );

    fireEvent.click(screen.getAllByTestId("diff-line-changed")[1]);
    await waitFor(() =>
      expect(screen.getByTestId("hunk-stage").textContent).not.toMatch(/line/i),
    );
  });

  it("falls back to whole-hunk staging with no selection", async () => {
    await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(screen.getByTestId("hunk-stage"));

    await waitFor(() => expect(stageHunkCall()).toBeDefined());
    expect(stageLinesCall()).toBeUndefined();
  });

  // After a partial stage the pane must show the NEW diff. The fetch effect keyed
  // only on path/side/embedded, none of which change when the same file is
  // partially staged, so the stale diff stayed on screen — and a follow-up
  // selection then sent indices into it while the backend recomputed a fresh
  // diff, staging different lines than the ones highlighted.
  it("refetches the diff after a partial stage", async () => {
    // refreshStatus fetches status and repo state together, so both must answer
    // or it fails and never publishes the new status.
    mockInvoke("repo_state", () => "Clean");
    const diffCalls = () => getInvokeCalls().filter((c) => c.cmd === "get_diff");
    const rows = await screen.findAllByTestId("diff-line-changed");
    await waitFor(() => expect(diffCalls().length).toBeGreaterThan(0));
    const before = diffCalls().length;

    fireEvent.click(rows[0]);
    await waitFor(() => expect(selCountLabel()).toMatch(/1 line/i));
    fireEvent.click(screen.getByTestId("hunk-stage"));

    await waitFor(() => expect(stageLinesCall()).toBeDefined());
    await waitFor(() => expect(diffCalls().length).toBeGreaterThan(before));
  });

  it("does not offer line selection while whitespace is ignored", async () => {
    await screen.findAllByTestId("diff-line-changed");
    fireEvent.click(screen.getByTitle("Ignore whitespace-only changes"));

    // Same reason hunk staging is disabled: ignore-whitespace rewrites hunk
    // boundaries, so these indices would not address what git applies.
    await waitFor(() =>
      expect(screen.getByTestId("hunk-stage")).toBeDisabled(),
    );
    expect(screen.queryAllByTestId("diff-line-changed")).toHaveLength(0);
  });
});
