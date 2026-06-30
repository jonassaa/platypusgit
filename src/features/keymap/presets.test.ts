import { describe, it, expect } from "vitest";
import { PLATYPUSGIT_PRESET, buildReverseMap, presetById } from "./presets";
import { ACTIONS, ALL_ACTION_IDS } from "./registry";

describe("platypusgit preset", () => {
  it("binds every action in the catalog", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(PLATYPUSGIT_PRESET.bindings[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("does not bind one chord to two different GLOBAL actions", () => {
    const rev = buildReverseMap(PLATYPUSGIT_PRESET);
    for (const [chord, ids] of rev) {
      const globals = ids.filter((id) => ACTIONS[id].scope === "global");
      expect(globals.length, `chord ${chord} -> ${globals.join(",")}`).toBeLessThanOrEqual(1);
    }
  });

  it("reverse map resolves Mod+1 to nav.files", () => {
    const rev = buildReverseMap(PLATYPUSGIT_PRESET);
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
  });

  it("presetById falls back to the default for unknown ids", () => {
    expect(presetById("nope").id).toBe("platypusgit");
  });
});
