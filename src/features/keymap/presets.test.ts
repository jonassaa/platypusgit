import { describe, it, expect } from "vitest";
import {
  BUILTIN_PRESETS,
  DEFAULT_PRESET,
  PLATYPUSGIT_PRESET,
  RIDER_PRESET,
  buildReverseMap,
  presetById,
} from "./presets";
import { ACTIONS, ALL_ACTION_IDS } from "./actions";

describe.each(BUILTIN_PRESETS.map((p) => [p.name, p] as const))(
  "preset %s",
  (_name, preset) => {
    it("binds every action in the catalog", () => {
      for (const id of ALL_ACTION_IDS) {
        expect(
          preset.bindings[id]?.length ?? 0,
          `action ${id} has no binding`,
        ).toBeGreaterThan(0);
      }
    });

    it("has no unknown action ids", () => {
      for (const id of Object.keys(preset.bindings)) {
        expect(ALL_ACTION_IDS).toContain(id);
      }
    });

    it("does not bind one chord to two different GLOBAL actions", () => {
      const rev = buildReverseMap(preset);
      for (const [chord, ids] of rev) {
        const globals = ids.filter((id) => ACTIONS[id].scope === "global");
        expect(
          globals.length,
          `chord ${chord} -> ${globals.join(",")}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  },
);

describe("rider preset (default)", () => {
  const rev = buildReverseMap(RIDER_PRESET);

  it("is the default preset", () => {
    expect(DEFAULT_PRESET.id).toBe("rider");
    expect(presetById("nope").id).toBe("rider");
  });

  it("matches Rider git chords", () => {
    expect(RIDER_PRESET.bindings["nav.commit"]).toContain("Mod+K");
    expect(RIDER_PRESET.bindings["repo.push"]).toContain("Mod+Shift+K");
    expect(RIDER_PRESET.bindings["repo.pull"]).toContain("Mod+T");
    expect(RIDER_PRESET.bindings["nav.diff"]).toContain("Mod+D");
    expect(RIDER_PRESET.bindings["nav.history"]).toContain("Mod+9");
    expect(RIDER_PRESET.bindings["palette.open"]).toContain("Mod+Shift+A");
    expect(RIDER_PRESET.bindings["palette.open"]).toContain("DoubleShift");
  });

  it("keeps positional Mod+N navigation for screens without a Rider chord", () => {
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
    expect(rev.get("Mod+4")).toEqual(["nav.branches"]);
    expect(rev.get("Mod+7")).toEqual(["nav.remote"]);
  });

  it("has exactly one chord per Rider-chorded screen — no number aliases", () => {
    // ⌘2/⌘3/⌘8 used to double-bind commit/history/diff; two clashing number
    // schemes were cheat-sheet noise (keymap review F4).
    expect(rev.get("Mod+2")).toBeUndefined();
    expect(rev.get("Mod+3")).toBeUndefined();
    expect(rev.get("Mod+8")).toBeUndefined();
    expect(RIDER_PRESET.bindings["nav.commit"]).toEqual(["Mod+K"]);
    expect(RIDER_PRESET.bindings["nav.history"]).toEqual(["Mod+9"]);
    expect(RIDER_PRESET.bindings["nav.diff"]).toEqual(["Mod+D"]);
  });

  it("reverse map resolves Mod+K to nav.commit", () => {
    expect(rev.get("Mod+K")).toEqual(["nav.commit"]);
  });

  it("binds F7/⇧F7 to diff-change navigation (Rider NextDiff/PreviousDiff)", () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.bindings["diff.nextChange"], p.id).toEqual(["F7"]);
      expect(p.bindings["diff.prevChange"], p.id).toEqual(["Shift+F7"]);
    }
  });

  it("binds the power shortcuts (2026-07-06 spec)", () => {
    expect(RIDER_PRESET.bindings["commit.commit"]).toEqual(["Mod+Enter"]);
    expect(RIDER_PRESET.bindings["commit.commitAndPush"]).toEqual(["Mod+Shift+Enter"]);
    expect(RIDER_PRESET.bindings["commit.toggleAmend"]).toEqual(["Mod+Shift+M"]);
    expect(RIDER_PRESET.bindings["repo.stageAll"]).toEqual(["Mod+Shift+S"]);
    expect(RIDER_PRESET.bindings["repo.unstageAll"]).toEqual(["Mod+Shift+U"]);
    expect(RIDER_PRESET.bindings["branch.createNew"]).toEqual(["Mod+N"]);
  });

  it("adds the Rider VCS-popup nod: palette on literal Ctrl+V", () => {
    // Ctrl+V is macOS-effective only by construction: on Win/Linux physical
    // Ctrl+V normalizes to Mod+V (unbound), so paste is untouched.
    expect(RIDER_PRESET.bindings["palette.open"]).toContain("Ctrl+V");
  });
});

describe("platypusgit preset", () => {
  const rev = buildReverseMap(PLATYPUSGIT_PRESET);

  it("keeps the classic number navigation", () => {
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
    expect(rev.get("Mod+2")).toEqual(["nav.commit"]);
    expect(rev.get("Mod+3")).toEqual(["nav.history"]);
    expect(rev.get("Mod+9")).toEqual(["nav.reflog"]);
  });

  it("shares the rider repo-op chords (review F2/F7: the old set collided)", () => {
    // Old classic bindings sat on entrenched chords: ⌘⇧P is the VS Code
    // command palette (a mutating push there is dangerous), ⌘⇧F is
    // find-in-files everywhere, ⌘⇧R is browser hard-reload.
    expect(rev.get("Mod+Shift+P")).toBeUndefined();
    expect(rev.get("Mod+Shift+F")).toBeUndefined();
    expect(rev.get("Mod+Shift+R")).toBeUndefined();
    expect(PLATYPUSGIT_PRESET.bindings["repo.push"]).toEqual(["Mod+Shift+K"]);
    expect(PLATYPUSGIT_PRESET.bindings["repo.pull"]).toEqual(["Mod+T"]);
    expect(PLATYPUSGIT_PRESET.bindings["repo.fetch"]).toEqual(["Mod+Shift+T"]);
    expect(PLATYPUSGIT_PRESET.bindings["repo.refresh"]).toEqual(["Mod+Alt+Y"]);
  });

  it("binds the power shortcuts with the shared chords, without Ctrl+V", () => {
    expect(PLATYPUSGIT_PRESET.bindings["commit.commit"]).toEqual(["Mod+Enter"]);
    expect(PLATYPUSGIT_PRESET.bindings["commit.commitAndPush"]).toEqual(["Mod+Shift+Enter"]);
    expect(PLATYPUSGIT_PRESET.bindings["commit.toggleAmend"]).toEqual(["Mod+Shift+M"]);
    expect(PLATYPUSGIT_PRESET.bindings["repo.stageAll"]).toEqual(["Mod+Shift+S"]);
    expect(PLATYPUSGIT_PRESET.bindings["repo.unstageAll"]).toEqual(["Mod+Shift+U"]);
    expect(PLATYPUSGIT_PRESET.bindings["branch.createNew"]).toEqual(["Mod+N"]);
    expect(PLATYPUSGIT_PRESET.bindings["palette.open"]).not.toContain("Ctrl+V");
  });
});
