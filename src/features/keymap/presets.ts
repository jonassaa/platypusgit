// Keymap presets — chord ↔ action binding tables. The keymap IS this data;
// no handler reads raw keys. KN2 will layer user overrides on top of a chosen
// preset, so the shape stays additive: presets are plain data.
//
// "rider" is the default: git chords mirror the JetBrains/IntelliJ macOS
// keymap (⌘K commit, ⌘⇧K push, ⌘T update/pull, ⌘D show diff, ⌘9 VCS log,
// ⌘⇧A find action, double-Shift search everywhere, ⌘⌥Y synchronize).
// ⌘⇧T fetch is a platypusgit EXTENSION, not a Rider binding — Rider has no
// default for Git Fetch (⌘⇧T there is "Go to Test"). It just pairs with ⌘T.
// Rider-chorded screens carry only their Rider chord; the ⌘N numbers cover
// the screens Rider has no chord for (no double-bound aliases). On
// Windows/Linux `Mod` is Ctrl, which diverges from JetBrains there (tool
// windows are Alt+N, settings Ctrl+Alt+S) — a documented trade for one
// cross-platform table (see the keyboard-navigation-v2 spec).

import { DOUBLE_SHIFT } from "./chord";
import type { ActionId } from "./actions";

export interface KeymapPreset {
  id: string;
  name: string;
  bindings: Partial<Record<ActionId, string[]>>;
}

/** Power shortcuts (2026-07-06 spec) — same chords in every preset; all
 *  collision-vetted (no Mod+Alt+letter → no AltGr conflicts on Windows). */
const POWER_SHORTCUTS = {
  "commit.commit": ["Mod+Enter"],
  "commit.commitAndPush": ["Mod+Shift+Enter"],
  "commit.toggleAmend": ["Mod+Shift+M"],
  "repo.stageAll": ["Mod+Shift+S"],
  "repo.unstageAll": ["Mod+Shift+U"],
  "branch.createNew": ["Mod+N"],
} satisfies Partial<Record<ActionId, string[]>>;

/** Bindings shared by every preset — panes, lists, overlay. */
const COMMON = {
  // Open repository (the status bar advertises ⌘O). Same chord both presets.
  "repo.open": ["Mod+O"],
  "repo.clone": ["Mod+Shift+O"],
  // Mod+N is new branch; Mod+Shift+N mirrors Mod+O/Mod+Shift+O open/clone.
  // NOT Mod+Alt+N — AltGr on Windows (see the no-new-Mod+Alt+letter rule in
  // presets.test.ts and the two specs it cites).
  "repo.init": ["Mod+Shift+N"],
  // ORDER IS LOAD-BEARING, the same way diff.viewCombined sits before nav.diff
  // below: buildReverseMap walks Object.entries, so the PANE action must be
  // offered before the global one, or app.closeOverlay (which is global with a
  // default runner) would answer Escape first everywhere. #241.
  "diff.closeFind": ["Escape"],
  "app.closeOverlay": ["Escape"],
  // Editor-style zoom. Two chords each: "Mod+=" is the unshifted key, "Mod++"
  // is what Shift+= (and the numpad plus) produce — eventToChord bakes the
  // shift into the character, so the shifted form is its own chord string.
  "view.zoomIn": ["Mod+=", "Mod++"],
  "view.zoomOut": ["Mod+-", "Mod+_"],
  "view.zoomReset": ["Mod+0"],
  "pane.focusLeft": ["Alt+ArrowLeft"],
  "pane.focusRight": ["Alt+ArrowRight"],
  "pane.focusUp": ["Alt+ArrowUp"],
  "pane.focusDown": ["Alt+ArrowDown"],
  "pane.focusNext": ["Tab"],
  "pane.focusPrev": ["Shift+Tab"],
  "list.up": ["ArrowUp"],
  "list.down": ["ArrowDown"],
  "list.expand": ["ArrowRight"],
  "list.collapse": ["ArrowLeft"],
  "list.activate": ["Enter"],
  "list.toggle": [" "],
  "list.top": ["Home"],
  "list.bottom": ["End"],
  // Extend a multi-selection range (History commit list). suppressInInput keeps
  // Shift+Arrow doing normal text selection inside inputs.
  "list.extendUp": ["Shift+ArrowUp"],
  "list.extendDown": ["Shift+ArrowDown"],
  // Rider NextDiff/PreviousDiff — real JetBrains bindings.
  "diff.nextChange": ["F7"],
  "diff.prevChange": ["Shift+F7"],
  // Same Space as list.toggle on purpose: in the file list Space stages the row,
  // in the diff pane it stages the focused line. One key, one meaning. Legal
  // because both actions are pane-scoped — presets.test.ts only forbids two
  // GLOBAL actions on one chord, and the dispatcher tries each id in turn.
  "diff.toggleLine": [" "],
  // The ordinary copy key, deliberately. `diff.copy`'s whole job is to extend
  // Mod+C to a selection the DOM cannot hold — the diff's selected LINES, which
  // outlive the rendered window — so putting it anywhere else would be a second
  // key for something the reader already knows how to ask for. It declines
  // whenever there IS a text selection (and whenever nothing is selected at all),
  // which leaves the chord unhandled and the webview's native copy in charge, so
  // this binding never takes Mod+C away from anything.
  "diff.copy": ["Mod+C"],
  // The find key every editor has, unshifted — ⌘⇧F is already tree.find (the
  // Files tree's filter), and the two are different questions asked of different
  // panes. Free in both presets. Pane-scoped and suppressInInput (see actions.ts),
  // so it never reaches a text field that wants ⌘F for itself. #241.
  "diff.find": ["Mod+F"],
  // The History selection's diff, on the same Mod+D as nav.diff (#158). Legal
  // because this one is pane-scoped: the dispatcher tries each id bound to a
  // chord in turn, and the pane handler declines unless the commit list has focus
  // with something selected (#164) — so Mod+D still reaches the Diff viewer
  // everywhere else. Rider's ⌘D is "Show diff", which is what both do.
  //
  // ORDER IS LOAD-BEARING: buildReverseMap walks Object.entries, so this entry
  // must come BEFORE nav.diff's, and it does because COMMON is spread first in
  // both presets. nav.diff is global WITH a default runner, so it never
  // declines — tried first it would shadow this action permanently. Pinned by
  // "Mod+D offers the pane action before the global one" in presets.test.ts.
  //
  // Bound in classic too (every catalog action must be), where nav.diff lives on
  // Mod+8 and Mod+D is otherwise free.
  "diff.viewCombined": ["Mod+D"],
  // Hunk-level Stage/Discard from the keyboard (#157). Mod+Shift+<letter> is
  // where repo OPS already live (S/U/M/K/T/Y/F/N/O) and H is free in both
  // presets; it is not Mod+Alt+<letter>, so the AltGr rule is satisfied. Note
  // Shift+Space could NOT be used for "the whole hunk, not just the line":
  // eventToChord bakes shift into a printable character and " " is not
  // alphanumeric, so Shift+Space and Space are the same chord. Discard takes a
  // named key rather than a letter — it is destructive (it still confirms), and
  // ⌫ reads that way. Both are pane-scoped, so they only fire in a diff pane.
  //
  // Unlike diff.viewCombined above, these two share their chords with NOTHING,
  // so their position in this table carries no meaning — the order rule bites
  // only where a pane action and a global one collide.
  "diff.stageHunk": ["Mod+Shift+H"],
  "diff.discardHunk": ["Mod+Shift+Backspace"],
  // Pull / merge requests (#92). The shifted-digit family is already where
  // screens without a primary number live (nav.reflog is ⌘⇧9 in rider), and
  // ⌘⇧8 is free in both presets — classic's asserted ⌘8 = Diff stays put.
  "nav.pulls": ["Mod+Shift+8"],
  // Repo OPS live on Mod+Shift+<letter> (S/U/M/K/T). Y carries no entrenched
  // meaning on any platform, and Shift — not Mod+Alt+<letter>, which the AltGr
  // rule forbids (see presets.test.ts).
  "forge.createPr": ["Mod+Shift+Y"],
  // Find-in-tree (matches the ⌘⇧F chip on the Files tree). Component-handled
  // by RepoBrowser; a find, not a mutating op, so ⌘⇧F muscle-memory is safe.
  "tree.find": ["Mod+Shift+F"],
  // Reorder a rebase step from the keyboard — the drag's equivalent (#91).
  // Rider's Move-Statement chord (⌘⇧↑/↓), free here: Shift+Arrow alone is
  // list.extend* and Alt+Arrow is pane traversal. Pane-scoped, so it only
  // reaches the rebase plan; suppressInInput keeps it off a caret.
  "rebase.moveStepUp": ["Mod+Shift+ArrowUp"],
  "rebase.moveStepDown": ["Mod+Shift+ArrowDown"],
  // #93 — the two new screens. Shared by both presets because the plain ⌘1–9 row
  // is fully taken in `platypusgit classic`, so a per-preset number would have to
  // collide with something. ⌘⇧6/7 continue the pattern rider already set with
  // ⌘⇧9 for the reflog, and digits resolve from `e.code` (see chord.ts), so these
  // are layout-independent — Shift+7 typing "/" or "&" on a given keyboard does
  // not change the chord.
  //
  // Submodules was ⌘⇧8 until #92 landed first and took it for `nav.pulls`; it
  // moved down to ⌘⇧6 rather than displacing a shipped binding. Two GLOBAL
  // actions on one chord is what presets.test.ts forbids, so this is a test
  // failure rather than a silent shadow — which is the intended outcome.
  "nav.submodules": ["Mod+Shift+6"],
  "nav.worktrees": ["Mod+Shift+7"],
  // Repository tabs (#90). Each of the first three carries BOTH the literal-Ctrl
  // and the Mod form on purpose, and that makes them correct on every platform
  // with one table: on macOS `Mod+Tab`/`Mod+W` are ⌘Tab (taken by the OS app
  // switcher, never delivered) and ⌘W (Tauri's default window menu may claim
  // it), so ⌃Tab/⌃W are the ones that reach us; on Windows/Linux physical Ctrl
  // normalizes to `Mod`, so the `Ctrl+…` spellings are never produced and the
  // `Mod+…` ones are the conventional chords. Same construction as the Ctrl+V
  // palette nod above.
  "tab.next": ["Ctrl+Tab", "Mod+Tab"],
  "tab.prev": ["Ctrl+Shift+Tab", "Mod+Shift+Tab"],
  "tab.close": ["Ctrl+W", "Mod+W"],
  // NOT Mod+1..9 (screen navigation) and NOT Mod+Alt+<digit> — Ctrl+Alt is
  // AltGr on Windows, and AltGr+2 / AltGr+4 type characters on Nordic layouts,
  // exactly the hazard presets.test.ts polices for letters. Plain Alt+<digit>
  // is unbound in both presets and Alt is already this keymap's second
  // modifier (Alt+Arrow moves panes).
  "tab.select": ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8", "Alt+9"],
  // Rider's ⌘E ("Recent files") — the palette's repository switcher.
  "tab.switch": ["Mod+E"],
} satisfies Partial<Record<ActionId, string[]>>;

export const RIDER_PRESET: KeymapPreset = {
  id: "rider",
  name: "JetBrains Rider (default)",
  bindings: {
    ...COMMON,
    "nav.files": ["Mod+1"],
    "nav.commit": ["Mod+K"],
    "nav.history": ["Mod+9"],
    "nav.branches": ["Mod+4"],
    "conflict.openResolver": ["Mod+5"],
    "nav.rebase": ["Mod+6"],
    "nav.remote": ["Mod+7"],
    "nav.diff": ["Mod+D"],
    "nav.reflog": ["Mod+Shift+9"],
    "nav.settings": ["Mod+,"],
    // Ctrl+V (literal Ctrl) nods to Rider's ⌃V VCS quick list. macOS-effective
    // only by construction: on Win/Linux physical Ctrl+V normalizes to Mod+V
    // (unbound), so paste is untouched.
    "palette.open": ["Mod+P", "Mod+Shift+A", DOUBLE_SHIFT, "Ctrl+V"],
    "app.cheatSheet": ["?"],
    "repo.fetch": ["Mod+Shift+T"],
    "repo.pull": ["Mod+T"],
    "repo.push": ["Mod+Shift+K"],
    "repo.refresh": ["Mod+Alt+Y"],
    ...POWER_SHORTCUTS,
  },
};

export const PLATYPUSGIT_PRESET: KeymapPreset = {
  id: "platypusgit",
  name: "platypusgit classic",
  bindings: {
    ...COMMON,
    "nav.files": ["Mod+1"],
    "nav.commit": ["Mod+2"],
    "nav.history": ["Mod+3"],
    "nav.branches": ["Mod+4"],
    "conflict.openResolver": ["Mod+5"],
    "nav.rebase": ["Mod+6"],
    "nav.remote": ["Mod+7"],
    "nav.diff": ["Mod+8"],
    "nav.reflog": ["Mod+9"],
    "nav.settings": ["Mod+,"],
    "palette.open": ["Mod+P"],
    "app.cheatSheet": ["?"],
    // Repo ops share the rider chords: the original classic set collided
    // with entrenched bindings (⌘⇧P is the VS Code command palette — a push
    // there is dangerous muscle-memory bait; ⌘⇧F is find-in-files; ⌘⇧R is
    // browser hard-reload). Classic's identity is the sequential ⌘1–9
    // screen numbers, not novel git chords.
    "repo.fetch": ["Mod+Shift+T"],
    "repo.pull": ["Mod+T"],
    "repo.push": ["Mod+Shift+K"],
    "repo.refresh": ["Mod+Alt+Y"],
    ...POWER_SHORTCUTS,
  },
};

export const BUILTIN_PRESETS: KeymapPreset[] = [RIDER_PRESET, PLATYPUSGIT_PRESET];

export const DEFAULT_PRESET = RIDER_PRESET;

export function presetById(id: string): KeymapPreset {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
}

/** Build the chord → action-ids lookup used by the dispatcher. */
export function buildReverseMap(p: KeymapPreset): Map<string, ActionId[]> {
  const m = new Map<string, ActionId[]>();
  for (const [id, chords] of Object.entries(p.bindings)) {
    for (const chord of chords ?? []) {
      const arr = m.get(chord) ?? [];
      arr.push(id as ActionId);
      m.set(chord, arr);
    }
  }
  return m;
}
