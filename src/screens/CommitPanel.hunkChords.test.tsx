// Hunk-level Stage/Discard from the keyboard (#157).
//
// The `@@` banner's buttons were mouse-only: `Tab` is bound to `pane.focusNext`,
// so DOM focus never enters a pane's buttons. Replacing the banner with a gutter
// cluster would have inherited that, so the cluster ships with two pane-scoped
// chords — and these tests are the claim that they reach the same backend ops the
// buttons do, address the hunk the cursor is on, and stay behind the
// ignore-whitespace gate.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { settleDiff } from "@/test/settle";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 2,
  deletions: 0,
  embedded: false,
});

/** Two hunks, far enough apart that F7 has somewhere to go. */
const twoHunks = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 2,
  deletions: 0,
  hunks: [1, 40].map((start) => ({
    header: `@@ -${start},1 +${start},2 @@`,
    oldStart: start,
    oldLines: 1,
    newStart: start,
    newLines: 2,
    lines: [
      { kind: { kind: "Context" as const }, oldLineno: start, newLineno: start, content: "base\n" },
      {
        kind: { kind: "Addition" as const },
        oldLineno: null,
        newLineno: start + 1,
        content: `add at ${start}\n`,
      },
    ],
  })),
});

const chord = (o: { key: string; code?: string }) =>
  ({
    key: o.key,
    code: o.code ?? "",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function press(e: KeyboardEvent): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(e);
  });
  return handled;
}

const stageHunkChord = () => press(chord({ key: "H", code: "KeyH" }));
const discardHunkChord = () => press(chord({ key: "Backspace" }));
const plainArrowDown = () =>
  press({
    key: "ArrowDown",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  } as unknown as KeyboardEvent);
const f7 = () =>
  press({
    key: "F7",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  } as unknown as KeyboardEvent);

const lastCall = (cmd: string) =>
  [...getInvokeCalls()].reverse().find((c) => c.cmd === cmd);

async function setup(o?: { ignoreWhitespace?: boolean }) {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: o?.ignoreWhitespace ?? false });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  const status = [unstaged("a.ts")];
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status,
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", (args) => twoHunks(args.path as string));
  mockInvoke("get_status", () => status);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("stage_hunk", () => undefined);
  mockInvoke("discard_hunk", () => undefined);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
  // The gutter cluster, not a changed LINE row: with whitespace ignored the line
  // rows lose their click target and their testid, but the cluster is still there
  // (disabled), which is the case this waits for in both variants.
  await screen.findAllByTestId("hunk-stage");
  await settleDiff();
  act(() => {
    useFocusStore.setState({ focused: "commit.diff" });
  });
}

describe("CommitPanel hunk chords (#157)", () => {
  describe("with a usable diff", () => {
    beforeEach(() => setup());

    it("declines until a cursor exists, rather than guessing at hunk 0", () => {
      // Discard is destructive: acting on an unnamed hunk would be worse than
      // doing nothing, so both chords fall through instead.
      expect(stageHunkChord()).toBe(false);
      expect(discardHunkChord()).toBe(false);
      expect(lastCall("stage_hunk")).toBeUndefined();
    });

    it("stages the hunk the F7 cursor sits on", async () => {
      f7();
      f7();
      expect(stageHunkChord()).toBe(true);
      await waitFor(() => expect(lastCall("stage_hunk")?.args.hunkIndex).toBe(1));
      expect(lastCall("stage_hunk")?.args.path).toBe("a.ts");
    });

    it("falls back to the line cursor's hunk when F7 has not moved", async () => {
      plainArrowDown();
      expect(stageHunkChord()).toBe(true);
      await waitFor(() => expect(lastCall("stage_hunk")?.args.hunkIndex).toBe(0));
    });

    it("confirms before discarding, then discards that hunk", async () => {
      f7();
      expect(discardHunkChord()).toBe(true);
      // WithDialogs renders the real PGDialogHost, so the confirm is a real modal.
      const confirmBtn = await screen.findByText("Discard hunk");
      expect(lastCall("discard_hunk")).toBeUndefined();
      act(() => {
        confirmBtn.click();
      });
      await waitFor(() => expect(lastCall("discard_hunk")?.args.hunkIndex).toBe(0));
    });
  });

  describe("with whitespace ignored", () => {
    beforeEach(() => setup({ ignoreWhitespace: true }));

    it("declines both chords, because hunk indices no longer address git's lines", () => {
      // The same #61 D2 gate the buttons and the line cursor sit behind — the
      // keyboard must never reach what the mouse cannot.
      f7();
      expect(stageHunkChord()).toBe(false);
      expect(discardHunkChord()).toBe(false);
      expect(lastCall("stage_hunk")).toBeUndefined();
    });
  });
});
