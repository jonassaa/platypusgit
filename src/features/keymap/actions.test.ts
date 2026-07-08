import { describe, it, expect, beforeEach } from "vitest";
import { ACTIONS, ALL_ACTION_IDS } from "./actions";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import { useOverlayStore } from "./useOverlayStore";

describe("action catalog", () => {
  it("every action has a title and category", () => {
    for (const id of ALL_ACTION_IDS) {
      const d = ACTIONS[id];
      expect(d.id).toBe(id);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.category.length).toBeGreaterThan(0);
    }
  });

  it("pane-scoped actions have no default runner (they need a focused pane)", () => {
    for (const id of ALL_ACTION_IDS) {
      const d = ACTIONS[id];
      if (d.scope === "pane") expect(d.run).toBeUndefined();
    }
  });

  it("global app actions all have default runners (or are component-handled)", () => {
    // commit.* act on CommitPanel component state (message/body/amend), so
    // the panel registers their handlers while mounted; elsewhere the chords
    // deliberately fall through. Every OTHER global action must have a
    // runner, or its chord is dead.
    const componentHandled = new Set([
      "commit.commit",
      "commit.commitAndPush",
      "commit.toggleAmend",
      // RepoBrowser focuses its tree filter box while mounted; falls through
      // on every other screen.
      "tree.find",
    ]);
    for (const id of ALL_ACTION_IDS) {
      const d = ACTIONS[id];
      if (d.scope === "global" && !componentHandled.has(id)) {
        expect(d.run, `global action ${id} needs a default runner`).toBeTypeOf(
          "function",
        );
      }
    }
  });

  it("only Escape-class actions are allowed inside inputs", () => {
    expect(ACTIONS["app.closeOverlay"].allowInInput).toBe(true);
    expect(ACTIONS["list.up"].allowInInput ?? false).toBe(false);
  });
});

describe("default runners", () => {
  beforeEach(() => {
    useNavStore.setState({ intent: null });
    usePaletteStore.setState({ open: false });
    useOverlayStore.setState({ cheatSheetOpen: false });
  });

  it("nav.* runners fire a switch-screen intent", () => {
    expect(ACTIONS["nav.history"].run?.()).not.toBe(false);
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "history",
    });
  });

  it("palette.open opens the palette; claims (no-op) when already open", () => {
    expect(ACTIONS["palette.open"].run?.()).not.toBe(false);
    expect(usePaletteStore.getState().open).toBe(true);
    // Still claimed when open — an unclaimed ⌘P/Ctrl+P would fall through to
    // the webview's native Print dialog.
    expect(ACTIONS["palette.open"].run?.()).not.toBe(false);
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it("app.cheatSheet toggles the overlay", () => {
    ACTIONS["app.cheatSheet"].run?.();
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(true);
    ACTIONS["app.cheatSheet"].run?.();
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
  });

  it("app.closeOverlay closes the cheat-sheet, else declines", () => {
    useOverlayStore.setState({ cheatSheetOpen: true });
    expect(ACTIONS["app.closeOverlay"].run?.()).not.toBe(false);
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
    // Nothing left to close — the runner must decline so Escape falls through.
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(false);
  });

  it("repo ops decline without an open repository", () => {
    expect(ACTIONS["repo.fetch"].run?.()).toBe(false);
    expect(ACTIONS["repo.pull"].run?.()).toBe(false);
    expect(ACTIONS["repo.push"].run?.()).toBe(false);
    expect(ACTIONS["repo.refresh"].run?.()).toBe(false);
  });
});
