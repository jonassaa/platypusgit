// A custom action's keyboard shortcut (#225) — what may be bound, what fires,
// and what the app refuses to let a chord collide with.

import { describe, it, expect, beforeEach, vi } from "vitest";

import { DOUBLE_SHIFT } from "@/features/keymap/chord";
import { RIDER_PRESET } from "@/features/keymap/presets";
import { useRepoStore } from "@/features/repo/useRepoStore";

import {
  boundChord,
  builtinChordOwner,
  chordConflict,
  describeConflict,
} from "./actionChords";
import {
  CHORD_IS_ALTGR,
  CHORD_NEEDS_ACCELERATOR,
  blankAction,
  chordRefusal,
  coerceCustomActions,
  isBindableChord,
  normalizeAction,
  normalizeChord,
  type CustomAction,
} from "./customActions";
import { runAction } from "./runAction";
import { buildUserBindings } from "./useCustomActionChords";

// The table is a SEAM: what it must get right is which chord maps to which
// action and when the key is declined — not what running one does, which
// `runAction` is tested for on its own.
vi.mock("./runAction", () => ({ runAction: vi.fn(async () => true) }));

const action = (over: Partial<CustomAction> = {}): CustomAction => ({
  id: "a",
  name: "Sync worktree",
  command: "sync $REPO",
  showOutput: false,
  refreshAfter: false,
  surfaces: ["repo"],
  chord: "",
  ...over,
});

// Free in BOTH presets — the union is what `chordConflict` checks.
const FREE = "Mod+Shift+X";

describe("what may be bound", () => {
  it("takes a chord carrying the platform accelerator", () => {
    expect(chordRefusal("Mod+Shift+X")).toBe(null);
    expect(chordRefusal("Ctrl+Shift+X")).toBe(null);
    expect(isBindableChord("Mod+G")).toBe(true);
  });

  it("takes a function key on its own — nothing types one", () => {
    expect(chordRefusal("F6")).toBe(null);
    expect(chordRefusal("Shift+F6")).toBe(null);
    expect(chordRefusal("F13")).toBe(CHORD_NEEDS_ACCELERATOR);
  });

  it("refuses a bare key: it would fire while arrowing through a list", () => {
    expect(chordRefusal("G")).toBe(CHORD_NEEDS_ACCELERATOR);
    expect(chordRefusal("Shift+G")).toBe(CHORD_NEEDS_ACCELERATOR);
    expect(chordRefusal("ArrowDown")).toBe(CHORD_NEEDS_ACCELERATOR);
  });

  it("refuses Alt alone — ⌥ with a character key TYPES on macOS", () => {
    expect(chordRefusal("Alt+E")).toBe(CHORD_NEEDS_ACCELERATOR);
  });

  it("refuses Mod+Alt+<letter>: that is AltGr on Windows", () => {
    // The rule presets.test.ts already enforces for shipped bindings. It
    // matters MORE here: a custom chord runs with the caret in a text field,
    // so ⌘⌥E would fire every time a Norwegian keyboard asks for €.
    expect(chordRefusal("Mod+Alt+E")).toBe(CHORD_IS_ALTGR);
    expect(chordRefusal("Ctrl+Alt+E")).toBe(CHORD_IS_ALTGR);
    // Not a letter — no AltGr sequence produces it, so it stays available.
    expect(chordRefusal("Mod+Alt+ArrowUp")).toBe(null);
  });

  it("refuses DoubleShift — the palette's own chord, in both presets", () => {
    expect(isBindableChord(DOUBLE_SHIFT)).toBe(false);
  });

  it("reads a missing or non-string chord as unbound", () => {
    expect(normalizeChord(undefined)).toBe("");
    expect(normalizeChord(42)).toBe("");
    expect(normalizeChord("  Mod+Shift+X  ")).toBe("Mod+Shift+X");
    expect(blankAction().chord).toBe("");
  });
});

describe("what actually fires", () => {
  it("is the stored chord when the action is on the palette", () => {
    expect(boundChord(action({ chord: FREE }))).toBe(FREE);
  });

  it("is nothing when the chord could never be recorded", () => {
    expect(boundChord(action({ chord: "G" }))).toBe("");
  });

  it("is nothing off the palette — a key press names no file or commit", () => {
    // `$FILE` and `$SHA` are filled by the menu that named them; a chord has no
    // such menu, so a shortcut is the PALETTE invocation and needs the palette.
    const menuOnly = action({ chord: FREE, surfaces: ["file"] });
    expect(boundChord(menuOnly)).toBe("");
  });

  it("keeps the stored chord through a surface change rather than clearing it", () => {
    // Unticking the palette must not lose what the user recorded — re-ticking
    // gives the shortcut back instead of asking them to remember it.
    const parked = normalizeAction(action({ chord: FREE, surfaces: ["file"] }));
    expect(parked.chord).toBe(FREE);
    expect(boundChord({ ...parked, surfaces: ["repo"] })).toBe(FREE);
  });

  it("is nothing when a built-in owns the chord", () => {
    // The dispatcher offers every catalog binding first, so this could never
    // fire — and a palette chip advertising ⌘K would be advertising Go to
    // Commit.
    expect(boundChord(action({ chord: "Mod+K" }))).toBe("");
  });
});

describe("coercion", () => {
  it("reads an action stored before shortcuts existed", () => {
    const legacy = { ...action(), chord: undefined } as unknown as CustomAction;
    expect(coerceCustomActions([legacy])?.[0].chord).toBe("");
  });

  it("keeps a stored chord that cannot fire instead of dropping it", () => {
    // What FIRES is `boundChord`'s question, asked fresh. Dropping the value
    // here would empty the field that shows it.
    const list = coerceCustomActions([{ ...action(), chord: "Mod+K" }]);
    expect(list?.[0].chord).toBe("Mod+K");
    expect(boundChord(list![0])).toBe("");
  });
});

describe("collisions", () => {
  it("names the built-in that already owns a chord", () => {
    const owner = builtinChordOwner("Mod+K");
    expect(owner?.title).toBe("Go to Commit");
    expect(owner?.preset).toBe(RIDER_PRESET.name);
    expect(builtinChordOwner(FREE)).toBe(null);
  });

  it("checks EVERY preset, not just the active one", () => {
    // Ctrl+V is the palette in rider only. Vetting against one preset alone
    // would hand it out, and it would go silently dead the day its owner
    // switched keymaps — the built-in always wins.
    expect(builtinChordOwner("Ctrl+V")).not.toBe(null);
    // ...and the other direction: a chord only the platypusgit preset binds.
    expect(builtinChordOwner("Mod+3")).not.toBe(null);
  });

  it("refuses a chord another custom action already fires", () => {
    const list = [action({ id: "other", name: "Deploy", chord: FREE })];
    const clash = chordConflict(FREE, list, "mine");
    expect(clash).toEqual({ kind: "custom", name: "Deploy" });
    expect(describeConflict(clash!)).toContain("Deploy");
  });

  it("does not count an action's own chord against it", () => {
    const list = [action({ id: "mine", chord: FREE })];
    expect(chordConflict(FREE, list, "mine")).toBe(null);
  });

  it("does not count a chord that cannot fire anyway", () => {
    // Parked off the palette: it is not competing for the key.
    const list = [action({ id: "other", chord: FREE, surfaces: ["file"] })];
    expect(chordConflict(FREE, list, "mine")).toBe(null);
  });
});

describe("the dispatcher's table", () => {
  beforeEach(() => {
    vi.mocked(runAction).mockClear();
    useRepoStore.setState({ current: null });
  });

  it("holds only chords that fire", () => {
    const map = buildUserBindings([
      action({ id: "a", name: "Live", chord: FREE }),
      action({ id: "b", name: "No chord" }),
      action({ id: "c", name: "Parked", chord: "F6", surfaces: ["file"] }),
    ]);
    expect([...map.keys()]).toEqual([FREE]);
    expect(map.get(FREE)?.title).toBe("Live");
  });

  it("gives a duplicated chord to the first claimant", () => {
    // Only reachable from a hand-edited file — the editor refuses the second.
    const map = buildUserBindings([
      action({ id: "a", name: "First", chord: FREE }),
      action({ id: "b", name: "Second", chord: FREE }),
    ]);
    expect(map.get(FREE)?.title).toBe("First");
  });

  it("declines with no repository open, so the key falls through", () => {
    const map = buildUserBindings([action({ chord: FREE })]);
    expect(map.get(FREE)?.run()).toBe(false);
  });

  it("claims the key and runs the action when there is a repository", () => {
    useRepoStore.setState({
      current: { id: "r1", path: "/tmp/r", name: "r" },
    } as unknown as Parameters<typeof useRepoStore.setState>[0]);
    const bound = action({ chord: FREE });
    const map = buildUserBindings([bound]);
    expect(map.get(FREE)?.run()).toBe(true);
    expect(runAction).toHaveBeenCalledWith(bound);
  });
});
