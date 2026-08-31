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

    // No new Mod+Alt+<letter> chords: on Windows, Ctrl+Alt = AltGr, which
    // types characters on many European layouts (e.g. AltGr+N -> "ń" on
    // Polish) — and useKeymapStore's hasRealModifier() treats any chord
    // containing "+Alt+" as a real modifier, so it still dispatches while
    // typing in an input/textarea, silently eating the character. Rule
    // documented in docs/superpowers/specs/2026-07-02-keyboard-navigation-v2-design.md:85-88
    // and docs/superpowers/specs/2026-07-06-keymap-power-shortcuts-design.md:58-59.
    // Mod+Alt+Y (repo.refresh) is the one grandfathered exception, vetted in
    // both specs because Y has no common AltGr assignment — allowlisted below
    // rather than exempted silently, so a new Mod+Alt+<letter> still fails.
    it("adds no new Mod+Alt+<letter> chords (AltGr on Windows) beyond the grandfathered Mod+Alt+Y", () => {
      const ALTGR_ALLOWLIST = new Set(["Mod+Alt+Y"]);
      for (const [id, chords] of Object.entries(preset.bindings)) {
        for (const chord of chords ?? []) {
          if (/^Mod\+Alt\+[A-Za-z]$/.test(chord) && !ALTGR_ALLOWLIST.has(chord)) {
            expect.fail(
              `${id} binds ${chord}, a new Mod+Alt+<letter> chord — forbidden ` +
                `(AltGr on Windows types characters on many European layouts; ` +
                `see the two keymap specs cited above the allowlist).`,
            );
          }
        }
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
    // command palette (a mutating push there is dangerous), ⌘⇧R is browser
    // hard-reload — neither is bound. ⌘⇧F IS bound, but to find-in-tree, which
    // is semantically the find-in-files chord users expect, not a mutating op.
    expect(rev.get("Mod+Shift+P")).toBeUndefined();
    expect(rev.get("Mod+Shift+R")).toBeUndefined();
    expect(rev.get("Mod+Shift+F")).toEqual(["tree.find"]);
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

// #158. Mod+D carries two actions: the global "go to the Diff viewer" and the
// History commit list's combined diff. The dispatcher tries the ids in the order
// buildReverseMap produced them and stops at the first that does not decline —
// and nav.diff is global WITH a default runner, so it NEVER declines. Tried
// first it would shadow the pane action permanently and silently; tried second it
// is the fallback the pane action's decline needs. That ordering is a fact about
// the preset TABLES (COMMON is spread before nav.diff), invisible at the call
// site, so it is pinned here.
describe("Mod+D is shared between a pane action and a global one (#158)", () => {
  for (const preset of BUILTIN_PRESETS) {
    it(`${preset.id}: offers the pane action before any global one`, () => {
      const ids = buildReverseMap(preset).get("Mod+D") ?? [];
      expect(ids[0]).toBe("diff.viewCombined");
      expect(ACTIONS["diff.viewCombined"].scope).toBe("pane");
      const globals = ids.filter((id) => ACTIONS[id].scope === "global");
      // Classic binds nav.diff to Mod+8, so there is nothing global on Mod+D
      // there; rider has exactly nav.diff. Either way every global id must sort
      // after the pane one.
      for (const g of globals) expect(ids.indexOf(g)).toBeGreaterThan(0);
    });
  }

  it("rider: the fallback behind the pane action is the Diff viewer", () => {
    expect(buildReverseMap(RIDER_PRESET).get("Mod+D")).toEqual([
      "diff.viewCombined",
      "nav.diff",
    ]);
  });
});

// Same asymmetry on Escape (#241): the diff find bar's close is pane-scoped and
// DECLINES when the bar is shut, so app.closeOverlay — global, with a default
// runner that never declines — must be offered second or it would swallow every
// Escape in the app.
describe("Escape is shared between the find bar and the overlay closer (#241)", () => {
  for (const preset of BUILTIN_PRESETS) {
    it(`${preset.id}: offers diff.closeFind before app.closeOverlay`, () => {
      const ids = buildReverseMap(preset).get("Escape") ?? [];
      expect(ids).toEqual(["diff.closeFind", "app.closeOverlay"]);
      expect(ACTIONS["diff.closeFind"].scope).toBe("pane");
      // A bare key inside the find bar's own input only dispatches for an action
      // that opted in — and the bar autofocuses that input.
      expect(ACTIONS["diff.closeFind"].allowInInput).toBe(true);
    });

    it(`${preset.id}: binds find-in-diff to the unshifted find key`, () => {
      // ⌘⇧F stays the Files tree's filter — a different question, a different pane.
      expect(preset.bindings["diff.find"]).toEqual(["Mod+F"]);
      expect(preset.bindings["tree.find"]).toEqual(["Mod+Shift+F"]);
      // The one rule that keeps ⌘F out of a text field that wants it.
      expect(ACTIONS["diff.find"].suppressInInput).toBe(true);
    });
  }
});

describe("repository tabs (#90)", () => {
  // Every preset binds them (the catalog-coverage test above enforces that);
  // these pin the SHAPE of the chords, which is what makes them work on every
  // platform and stay clear of AltGr.
  for (const preset of BUILTIN_PRESETS) {
    it(`${preset.id}: next/prev/close carry both the literal-Ctrl and Mod forms`, () => {
      // macOS delivers ⌃Tab/⌃W (⌘Tab is the OS app switcher, ⌘W may be Tauri's
      // window menu); Windows/Linux normalize physical Ctrl to Mod, so only the
      // Mod spelling is ever produced there. Both = one table, every platform.
      expect(preset.bindings["tab.next"]).toEqual(["Ctrl+Tab", "Mod+Tab"]);
      expect(preset.bindings["tab.prev"]).toEqual([
        "Ctrl+Shift+Tab",
        "Mod+Shift+Tab",
      ]);
      expect(preset.bindings["tab.close"]).toEqual(["Ctrl+W", "Mod+W"]);
    });

    it(`${preset.id}: tab.select is Alt+1..Alt+9, never Mod+Alt+<digit>`, () => {
      const chords = preset.bindings["tab.select"] ?? [];
      expect(chords).toHaveLength(9);
      chords.forEach((c, i) => expect(c).toBe(`Alt+${i + 1}`));
      // Ctrl+Alt is AltGr on Windows, and AltGr+2 / AltGr+4 type characters on
      // Nordic layouts — the same hazard the Mod+Alt+<letter> rule polices.
      for (const c of chords) expect(c).not.toMatch(/^Mod\+Alt\+/);
    });

    it(`${preset.id}: the screen numbers keep Mod+<digit> to themselves`, () => {
      const rev = buildReverseMap(preset);
      for (let n = 1; n <= 9; n++) {
        expect(rev.get(`Mod+${n}`) ?? []).not.toContain("tab.select");
      }
    });

    it(`${preset.id}: moving a tab is the horizontal Move-Statement chord`, () => {
      // The drag's keyboard equivalent (#238), and the horizontal analogue of
      // rebase.moveStepUp/Down. Free because that pair is pane-scoped to the
      // rebase plan while these two are global.
      expect(preset.bindings["tab.moveLeft"]).toEqual(["Mod+Shift+ArrowLeft"]);
      expect(preset.bindings["tab.moveRight"]).toEqual(["Mod+Shift+ArrowRight"]);
    });

    it(`${preset.id}: tab.switch is Rider's recent-files chord`, () => {
      expect(preset.bindings["tab.switch"]).toEqual(["Mod+E"]);
    });
  }
});
