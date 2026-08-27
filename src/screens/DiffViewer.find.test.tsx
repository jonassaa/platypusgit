// Find in diff on a real surface (#241).
//
// `useDiffFind.test.tsx` pins the hook against a harness; this pins that the
// DiffViewer actually wires it — the chord reaches the pane, the count is over
// the whole file rather than the mounted rows, and the highlight lands in the
// markup the screen renders.
//
// jsdom lays nothing out, so the viewport measures 0 and `windowVariable` falls
// back to a screenful: a 400-line diff mounts a few dozen rows, which is what
// makes the "counted but not mounted" assertion meaningful here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiffViewerScreen } from "./DiffViewer";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useFocusStore, useKeymapStore } from "@/features/keymap";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async () => null, // plain rows; this suite is about find
}));

const LINES = 400;
const NEAR = 2; // inside the first window
const FAR = 380; // far outside it

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

const diff = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [
    {
      header: `@@ -1,${LINES} +1,${LINES} @@`,
      oldStart: 1,
      oldLines: LINES,
      newStart: 1,
      newLines: LINES,
      lines: Array.from({ length: LINES }, (_, i) => ({
        kind: { kind: "Context" as const },
        oldLineno: i + 1,
        newLineno: i + 1,
        content: i === NEAR || i === FAR ? `carries a needle ${i}` : `line ${i}`,
      })),
    },
  ],
});

const findChord = (target?: EventTarget) => {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch({
      key: "f",
      code: "KeyF",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      target: target ?? document.body,
    } as unknown as KeyboardEvent);
  });
  return handled;
};

beforeEach(async () => {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  } as never);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_status", () => [unstaged("a.ts")]);
  mockInvoke("get_diff", (args) => diff(args.path as string));
  mockInvoke("read_file_content", () => ({
    path: "a.ts", binary: false, text: "x", fromHead: false, size: 1,
  }));
  mockInvoke("read_file_content_at_rev", () => ({
    path: "a.ts", binary: false, text: "x", fromHead: true, size: 1,
  }));
  render(
    <WithDialogs>
      <DiffViewerScreen />
    </WithDialogs>,
  );
  await waitFor(() => expect(screen.getByText("line 0")).toBeInTheDocument());
  act(() => {
    useFocusStore.setState({ focused: "diff.view" } as never);
  });
});

describe("DiffViewer find in diff", () => {
  it("counts matches the rendered window cannot see", async () => {
    expect(findChord()).toBe(true);
    fireEvent.change(screen.getByTestId("diff-find-input"), {
      target: { value: "needle" },
    });
    // The far match is genuinely not in the document...
    expect(screen.queryByText(`carries a needle ${FAR}`)).not.toBeInTheDocument();
    // ...and is counted anyway. Two of two, from the row model.
    expect(screen.getByTestId("diff-find-count").textContent).toBe("1 of 2");
  });

  it("highlights the match that IS on screen, marking the current one", () => {
    findChord();
    fireEvent.change(screen.getByTestId("diff-find-input"), {
      target: { value: "needle" },
    });
    const hits = document.querySelectorAll('[data-testid="diff-find-match"]');
    expect([...hits].map((el) => el.textContent)).toEqual(["needle"]);
    expect(hits[0].hasAttribute("data-find-active")).toBe(true);
  });

  it("keeps the whole file on screen — this is a find, not a filter", () => {
    // The old "Find in diff" on this screen rewrote the hunks down to matching
    // lines, so typing a query deleted the file around it. Non-matching rows must
    // survive.
    findChord();
    fireEvent.change(screen.getByTestId("diff-find-input"), {
      target: { value: "needle" },
    });
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.getByText("line 1")).toBeInTheDocument();
  });

  it("declines the chord while the caret is in the file filter", () => {
    // The screen's own filter box: Mod+F there belongs to the input.
    const filter = document.querySelector("input") as HTMLInputElement;
    expect(filter).toBeTruthy();
    expect(findChord(filter)).toBe(false);
    expect(screen.queryByTestId("diff-find-bar")).not.toBeInTheDocument();
  });
});
