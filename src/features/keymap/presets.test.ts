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

  it("keeps positional Mod+N navigation working", () => {
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
    expect(rev.get("Mod+2")).toEqual(["nav.commit"]);
    expect(rev.get("Mod+4")).toEqual(["nav.branches"]);
  });

  it("reverse map resolves Mod+K to nav.commit", () => {
    expect(rev.get("Mod+K")).toEqual(["nav.commit"]);
  });
});

describe("platypusgit preset", () => {
  it("keeps the classic bindings", () => {
    const rev = buildReverseMap(PLATYPUSGIT_PRESET);
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
    expect(rev.get("Mod+9")).toEqual(["nav.reflog"]);
    expect(rev.get("Mod+Shift+P")).toEqual(["repo.push"]);
  });
});
