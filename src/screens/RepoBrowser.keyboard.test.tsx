// Keyboard behavior of the RepoBrowser file tree (#61 A7). The tree used to
// have a local onKeyDown that only understood bare arrows; it now routes
// through the keymap's usePaneList, so it gets Home/End, Shift+Arrow ranges,
// Space-to-stage and type-to-jump speed-search like every flat pane.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import {
  useKeymapStore,
  useFocusStore,
  useSpeedSearchStore,
} from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

const modified = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
    ...over,
  }) as unknown as KeyboardEvent;

function press(k: string, over: Partial<KeyboardEvent> = {}): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k, over));
  });
  return handled;
}

function row(path: string): HTMLElement {
  const el = document.querySelector(`[data-pg-row][data-path="${path}"]`);
  if (!el) throw new Error(`no tree row for ${path}`);
  return el as HTMLElement;
}

const isSelected = (path: string) => row(path).hasAttribute("data-selected");
const exists = (path: string) =>
  !!document.querySelector(`[data-pg-row][data-path="${path}"]`);

const stageCalls: string[][] = [];

describe("RepoBrowser tree keyboard navigation (#61 A7)", () => {
  beforeEach(() => {
    stageCalls.length = 0;
    mockInvoke("get_diff", (args) => ({
      path: args.path as string,
      oldPath: null,
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
    }));
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      // Tree: /src (folder) → a.ts, b.ts ; /z.txt at top level.
      status: [modified("src/a.ts"), modified("src/b.ts"), modified("z.txt")],
      allFiles: [],
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: [],
      loading: false,
      error: null,
      repoState: "Clean",
      rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
      activity: {},
      stage: async (paths: string[]) => {
        stageCalls.push(paths);
      },
      unstage: async () => {},
    } as never);
    useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
    useKeymapStore.getState().setPreset("rider");
    useSpeedSearchStore.setState({ queries: {} });
    useFocusStore.setState({
      focused: null,
      panes: new Map(),
      order: [],
      barId: null,
      pendingContentFocus: false,
    });
  });

  async function mount() {
    render(<RepoBrowserScreen />);
    await waitFor(() => row("src"));
    useFocusStore.setState({ focused: "repo.tree" });
  }

  it("arrows walk the visible rows, folders included", async () => {
    await mount();

    // Nothing is selected until the user acts, and the first ↓ must land on
    // row 0 rather than skipping it.
    expect(isSelected("src")).toBe(false);

    // The first top-level folder is expanded by default: src, src/a.ts,
    // src/b.ts, z.txt.
    press("ArrowDown");
    expect(isSelected("src")).toBe(true);
    press("ArrowDown");
    expect(isSelected("src/a.ts")).toBe(true);
    press("ArrowDown");
    expect(isSelected("src/b.ts")).toBe(true);
    press("ArrowDown");
    expect(isSelected("z.txt")).toBe(true);

    // End of list clamps rather than wrapping.
    press("ArrowDown");
    expect(isSelected("z.txt")).toBe(true);
  });

  it("Home and End jump to the ends — chords the old handler ignored", async () => {
    await mount();

    press("End");
    expect(isSelected("z.txt")).toBe(true);
    press("Home");
    expect(isSelected("src")).toBe(true);
  });

  it("left collapses a folder, right re-expands it", async () => {
    await mount();
    expect(exists("src/a.ts")).toBe(true);
    press("ArrowDown"); // src

    press("ArrowLeft");
    expect(exists("src/a.ts")).toBe(false);
    expect(isSelected("src")).toBe(true);

    press("ArrowRight");
    expect(exists("src/a.ts")).toBe(true);
  });

  it("left from a leaf jumps to its parent folder", async () => {
    await mount();
    press("ArrowDown"); // src
    press("ArrowDown"); // src/a.ts
    expect(isSelected("src/a.ts")).toBe(true);

    press("ArrowLeft");
    expect(isSelected("src")).toBe(true);
    // The folder is still open — moving to the parent must not also collapse.
    expect(exists("src/a.ts")).toBe(true);
  });

  it("Shift+Arrow extends a range and keeps growing it", async () => {
    await mount();
    press("ArrowDown"); // src
    press("ArrowDown"); // anchor on src/a.ts

    press("ArrowDown", { shiftKey: true });
    expect(isSelected("src/a.ts")).toBe(true);
    expect(isSelected("src/b.ts")).toBe(true);

    // Repeated extends move the far end, not back to the anchor.
    press("ArrowDown", { shiftKey: true });
    expect(isSelected("src/a.ts")).toBe(true);
    expect(isSelected("src/b.ts")).toBe(true);
    expect(isSelected("z.txt")).toBe(true);
  });

  it("Space stages the selected file", async () => {
    await mount();
    press("ArrowDown"); // src
    press("ArrowDown"); // src/a.ts

    press(" ");
    await waitFor(() => expect(stageCalls).toEqual([["src/a.ts"]]));
  });

  it("Space on a folder stages everything beneath it", async () => {
    await mount();
    press("ArrowDown"); // src
    expect(isSelected("src")).toBe(true);

    press(" ");
    await waitFor(() =>
      expect(stageCalls).toEqual([["src/a.ts", "src/b.ts"]]),
    );
  });

  it("type-to-jump speed-search moves the selection to a matching path", async () => {
    await mount();

    // A bare printable key falls through to the pane's speed-search.
    press("z", { code: "KeyZ" });
    await waitFor(() => expect(isSelected("z.txt")).toBe(true));
  });
});
