// Mod+C in the diff pane: copy WHAT IS SELECTED, and nothing clever.
//
// The diff surfaces are windowed, so a mouse selection cannot reach past the
// rendered rows. `diff.copy` is the path that can: it copies the selected diff
// LINES from the model, however many there are and wherever they are.
//
// The contract that matters most here is the declining, not the copying. Mod+C
// must stay the ordinary copy key: whenever there is a text selection, or
// nothing is selected at all, or focus is anywhere but a diff pane, this action
// steps aside (`dispatch` returns false → no preventDefault) and the webview's
// native copy runs untouched.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { settleDiff } from "@/test/settle";
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

/** A leading context line then three additions → changed indices 0,1,2. */
const diff = (path: string) => ({
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

const copied: string[] = [];

/** The Mod+C keydown, as the real dispatcher sees it. */
const copyChord = (target: EventTarget = document.body) =>
  ({
    key: "c",
    code: "KeyC",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target,
  }) as unknown as KeyboardEvent;

function press(e: KeyboardEvent): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(e);
  });
  return handled;
}

const changedRows = () => screen.getAllByTestId("diff-line-changed");
const selCountLabel = () => screen.getByTestId("hunk-stage").textContent ?? "";

/** Select `n` changed lines, waiting for each to register. */
async function selectLines(indices: number[]) {
  for (const [i, idx] of indices.entries()) {
    fireEvent.click(changedRows()[idx]);
    const want = new RegExp(`${i + 1} lines?`, "i");
    await waitFor(() => expect(selCountLabel()).toMatch(want));
  }
}

async function setup() {
  resetInvokeMock();
  copied.length = 0;
  window.getSelection()?.removeAllRanges();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn((t: string) => void copied.push(t)) },
  });
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", (args) => diff(args.path as string));
  mockInvoke("get_status", () => [unstaged("a.ts")]);
  mockInvoke("stage_lines", () => undefined);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
  await screen.findAllByTestId("diff-line-changed");
  await settleDiff();
  act(() => {
    useFocusStore.setState({ focused: "commit.diff" });
  });
}

describe("Mod+C in the CommitPanel diff", () => {
  beforeEach(setup);

  it("copies the selected lines as bare code, in file order", async () => {
    await selectLines([2, 0]);
    expect(press(copyChord())).toBe(true);
    expect(copied).toEqual(["add1\nadd3"]);
  });

  it("copies one selected line", async () => {
    await selectLines([1]);
    expect(press(copyChord())).toBe(true);
    expect(copied).toEqual(["add2"]);
  });

  // Every case below must DECLINE, so that Mod+C keeps meaning "copy" — a
  // handled chord would preventDefault and swallow the native copy.
  it("declines to the native copy when text is selected", async () => {
    await selectLines([0]);
    const code = [...document.querySelectorAll(".pg-selectable")].find(
      (el) => (el.textContent ?? "").length > 0,
    )!;
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    // The premise of the test, asserted rather than assumed: without a live text
    // selection there is nothing for the action to stand aside for.
    expect(sel.isCollapsed).toBe(false);
    expect(press(copyChord())).toBe(false);
    expect(copied).toEqual([]);
  });

  it("declines when no lines are selected", () => {
    expect(press(copyChord())).toBe(false);
    expect(copied).toEqual([]);
  });

  it("declines when focus is on another pane", async () => {
    await selectLines([0]);
    act(() => {
      useFocusStore.setState({ focused: "commit.files" });
    });
    expect(press(copyChord())).toBe(false);
    expect(copied).toEqual([]);
  });

  // Right-click is the discoverable half of the same capability: a reader who
  // never learns the chord still has to be able to copy more than a screenful.
  it("offers the line selection on the diff's context menu", async () => {
    await selectLines([0, 1]);
    fireEvent.contextMenu(screen.getByLabelText("Diff"));
    expect(await screen.findByText("Copy 2 selected lines")).toBeTruthy();
    expect(screen.getByText("Copy file diff as text")).toBeTruthy();
  });

  it("copies the whole file from that menu", async () => {
    fireEvent.contextMenu(screen.getByLabelText("Diff"));
    fireEvent.click(await screen.findByText("Copy file diff as text"));
    expect(copied).toEqual([
      ["@@ -1,1 +1,4 @@", " base", "+add1", "+add2", "+add3"].join("\n"),
    ]);
  });

  it("declines inside a textarea, so typing a message copies normally", async () => {
    await selectLines([0]);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    expect(press(copyChord(ta))).toBe(false);
    expect(copied).toEqual([]);
    ta.remove();
  });
});
