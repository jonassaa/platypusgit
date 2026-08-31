import { describe, it, expect, beforeEach } from "vitest";
import { ACTIONS, ALL_ACTION_IDS } from "./actions";
import { useCreateStore } from "@/features/create/useCreateStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import { useOverlayStore } from "./useOverlayStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { newTab } from "@/features/repo/tabs";

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
    // commit.* act on CommitPanel component state (message/amend), so
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

  it("app.closeOverlay also closes an open create dialog (clone or init)", () => {
    useOverlayStore.setState({ cheatSheetOpen: false });
    useCreateStore.setState({ open: "clone", busy: false });
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(true);
    expect(useCreateStore.getState().open).toBe("none");
    // ...and still declines once it is closed.
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(false);
  });

  it("app.closeOverlay claims the chord even while a clone/init is busy (close() no-ops then by design)", () => {
    useOverlayStore.setState({ cheatSheetOpen: false });
    useCreateStore.setState({ open: "clone", busy: true });
    // Claimed so Escape doesn't fall through to another overlay action
    // mid-run, even though the dialog itself stays open.
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(true);
    expect(useCreateStore.getState().open).toBe("clone");
    useCreateStore.setState({ open: "none", busy: false });
  });

  it("app.closeOverlay also closes the update panel", () => {
    useOverlayStore.setState({ cheatSheetOpen: false });
    useUpdateStore.setState({ panelOpen: true });
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(true);
    expect(useUpdateStore.getState().panelOpen).toBe(false);
    // ...and still declines once it is closed.
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(false);
  });

  it("repo ops decline without an open repository", () => {
    expect(ACTIONS["repo.fetch"].run?.()).toBe(false);
    expect(ACTIONS["repo.pull"].run?.()).toBe(false);
    expect(ACTIONS["repo.push"].run?.()).toBe(false);
    expect(ACTIONS["repo.refresh"].run?.()).toBe(false);
  });
});

describe("moving the active repository tab (#238)", () => {
  const seed = (paths: string[], active: string | null) =>
    useTabsStore.setState({
      tabs: paths.map((p) => newTab(p)),
      activePath: active,
    } as never);

  const order = () => useTabsStore.getState().tabs.map((t) => t.path);

  beforeEach(() => {
    localStorage.clear();
    seed([], null);
  });

  it("moves the active tab right", () => {
    seed(["/a", "/b", "/c"], "/a");
    expect(ACTIONS["tab.moveRight"].run?.()).toBe(true);
    expect(order()).toEqual(["/b", "/a", "/c"]);
  });

  it("moves the active tab left", () => {
    seed(["/a", "/b", "/c"], "/c");
    expect(ACTIONS["tab.moveLeft"].run?.()).toBe(true);
    expect(order()).toEqual(["/a", "/c", "/b"]);
  });

  it("declines at either end rather than wrapping", () => {
    // A drag cannot wrap either, and a chord that silently teleports a tab from
    // one end of the strip to the other reads as a bug. Declining also lets the
    // chord fall through instead of doing nothing.
    seed(["/a", "/b"], "/a");
    expect(ACTIONS["tab.moveLeft"].run?.()).toBe(false);
    seed(["/a", "/b"], "/b");
    expect(ACTIONS["tab.moveRight"].run?.()).toBe(false);
    expect(order()).toEqual(["/a", "/b"]);
  });

  it("declines when there is no active tab", () => {
    seed([], null);
    expect(ACTIONS["tab.moveLeft"].run?.()).toBe(false);
    expect(ACTIONS["tab.moveRight"].run?.()).toBe(false);
  });
});
