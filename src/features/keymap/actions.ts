// Action catalog — the single source of truth for every bindable action.
// Screens dispatch action ids; they never read raw key events. Keymap presets
// map chords onto these ids (see presets.ts); the palette and cheat-sheet
// render from this same catalog, so shortcut labels can never drift.
//
// An action may carry a default runner (`run`). The dispatcher invokes it when
// no component handler claims the action — global app behaviors (navigation,
// palette, repo ops) live here as data instead of useEffect wiring in AppShell.
// A runner returns `false` to decline (nothing to do), letting the key fall
// through to the browser.

import { useCreateStore } from "@/features/create/useCreateStore";
import { useCreateTagStore } from "@/features/tags/useCreateTagStore";
import { useForgeStore } from "@/features/forge/useForgeStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import { useTerminalStore } from "@/features/terminal/useTerminalStore";
import {
  cloneRepoOp,
  fetchAllOp,
  initRepoOp,
  openRepoOp,
  pullCurrentOp,
  pushCurrentOp,
  redoOp,
  refreshOp,
  resolveConflictsOp,
  stageAllOp,
  undoOp,
  unstageAllOp,
} from "@/features/repo/ops";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { createBranchInputStep, switchRepoStep } from "@/features/palette/steps";
import { useFocusStore } from "./useFocusStore";
import { useOverlayStore } from "./useOverlayStore";

export type ActionScope = "global" | "pane";
export type ActionCategory =
  | "Navigation"
  | "Panes"
  | "Lists & trees"
  | "Diff"
  | "Repository"
  | "Palette"
  | "App";

export type ActionId =
  | "nav.files"
  | "nav.commit"
  | "nav.history"
  | "nav.branches"
  | "nav.rebase"
  | "nav.remote"
  | "nav.pulls"
  | "nav.diff"
  | "nav.reflog"
  | "nav.submodules"
  | "nav.worktrees"
  | "nav.settings"
  | "palette.open"
  | "app.cheatSheet"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "terminal.toggle"
  | "app.closeOverlay"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "list.up"
  | "list.down"
  | "list.expand"
  | "list.collapse"
  | "list.activate"
  | "list.toggle"
  | "list.top"
  | "list.bottom"
  | "list.extendUp"
  | "list.extendDown"
  | "repo.fetch"
  | "repo.pull"
  | "repo.push"
  | "repo.undo"
  | "repo.redo"
  | "repo.refresh"
  | "repo.stageAll"
  | "repo.unstageAll"
  | "conflict.openResolver"
  | "diff.nextChange"
  | "diff.prevChange"
  | "diff.toggleLine"
  | "diff.viewCombined"
  | "diff.stageHunk"
  | "diff.discardHunk"
  | "diff.copy"
  | "diff.find"
  | "diff.closeFind"
  | "commit.commit"
  | "commit.commitAndPush"
  | "commit.toggleAmend"
  | "branch.createNew"
  | "rebase.moveStepUp"
  | "rebase.moveStepDown"
  | "tree.find"
  | "repo.open"
  | "repo.clone"
  | "repo.init"
  | "forge.createPr"
  | "tab.next"
  | "tab.prev"
  | "tab.close"
  | "tab.moveLeft"
  | "tab.moveRight"
  | "tab.select"
  | "tab.switch";

export interface ActionDef {
  id: ActionId;
  title: string;
  category: ActionCategory;
  scope: ActionScope;
  /** When true the dispatcher still resolves this action inside text inputs
   *  even for chords without a real modifier (Escape, DoubleShift). */
  allowInInput?: boolean;
  /** When true the dispatcher NEVER resolves this action inside text inputs,
   *  even for chords with a real modifier — for chords the platform gives
   *  the caret (Alt+Arrow is word/paragraph movement on macOS). */
  suppressInInput?: boolean;
  /** Default runner, used when no mounted handler claims the action.
   *  Return `false` to decline.
   *
   *  Receives the chord that resolved to this action, so ONE action can serve a
   *  family of chords (`tab.select` on Alt+1…Alt+9) instead of needing nine
   *  catalog entries and nine cheat-sheet rows. Almost every runner ignores it. */
  run?: (chord?: string) => boolean | void;
}

function navTo(screen: string): () => boolean {
  return () => {
    useNavStore.getState().setIntent({ kind: "switch-screen", screen });
    return true;
  };
}

/** Tab-cycling must not steal focus from interactive controls — a button or
 *  input keeps native Tab behavior; pane-level focus cycles panes. */
function onInteractiveElement(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    (tag === "A" && el.hasAttribute("href")) ||
    el.isContentEditable === true
  );
}

/** Cycle repository tabs, declining when there is nothing to cycle to. */
function stepTab(delta: 1 | -1): boolean {
  if (useTabsStore.getState().tabs.length < 2) return false;
  void useTabsStore.getState().step(delta);
  return true;
}

/**
 * Move the ACTIVE tab one place (#238) — the drag's keyboard equivalent.
 *
 * Declines at either end rather than wrapping: a drag cannot wrap either, and a
 * silently-wrapping chord on a strip the user is looking at reads as a bug.
 * Declining also lets the chord fall through instead of doing nothing.
 */
function moveActiveTab(delta: 1 | -1): boolean {
  const { tabs, activePath } = useTabsStore.getState();
  const from = tabs.findIndex((t) => t.path === activePath);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= tabs.length) return false;
  useTabsStore.getState().reorder(from, to);
  return true;
}

function cyclePane(delta: 1 | -1): () => boolean {
  return () => {
    if (onInteractiveElement()) return false;
    useFocusStore.getState().cycle(delta);
    return true;
  };
}

export const ACTIONS: Record<ActionId, ActionDef> = {
  "nav.files": { id: "nav.files", title: "Go to Files", category: "Navigation", scope: "global", run: navTo("repo") },
  "nav.commit": { id: "nav.commit", title: "Go to Commit", category: "Navigation", scope: "global", run: navTo("commit") },
  "nav.history": { id: "nav.history", title: "Go to History", category: "Navigation", scope: "global", run: navTo("history") },
  "nav.branches": { id: "nav.branches", title: "Go to Branches", category: "Navigation", scope: "global", run: navTo("branches") },
  "nav.rebase": { id: "nav.rebase", title: "Go to Rebase", category: "Navigation", scope: "global", run: navTo("rebase") },
  "nav.remote": { id: "nav.remote", title: "Go to Remotes", category: "Navigation", scope: "global", run: navTo("remote") },
  "nav.pulls": { id: "nav.pulls", title: "Go to Pull requests", category: "Navigation", scope: "global", run: navTo("pulls") },
  "nav.diff": { id: "nav.diff", title: "Go to Diff viewer", category: "Navigation", scope: "global", run: navTo("diff") },
  "nav.reflog": { id: "nav.reflog", title: "Go to Reflog", category: "Navigation", scope: "global", run: navTo("reflog") },
  // #93. Screens only — the bisect ops deliberately get no chords: every action in
  // the catalog must be bound in both presets, the number chords are full, and a
  // bare-chord misfire mid-bisect silently corrupts the search with no undo short
  // of a reset. Bisect is driven from the operation bar, the History commit menu
  // and the palette, all of which name the commit they act on.
  "nav.submodules": { id: "nav.submodules", title: "Go to Submodules", category: "Navigation", scope: "global", run: navTo("submodules") },
  "nav.worktrees": { id: "nav.worktrees", title: "Go to Worktrees", category: "Navigation", scope: "global", run: navTo("worktrees") },
  "nav.settings": { id: "nav.settings", title: "Open Settings", category: "Navigation", scope: "global", run: navTo("settings") },

  "palette.open": {
    id: "palette.open",
    title: "Command palette",
    category: "Palette",
    scope: "global",
    // DoubleShift must work mid-typing, like Rider's Search Everywhere.
    allowInInput: true,
    run: () => {
      // Claim the chord even when already open: an unclaimed ⌘P/Ctrl+P falls
      // through to the webview's native Print dialog.
      if (!usePaletteStore.getState().open) {
        usePaletteStore.getState().openPalette();
      }
      return true;
    },
  },

  // Zoom the whole UI, editor-style. allowInInput: an editor zooms while you
  // type, and the chords are pure modifier chords the caret has no use for.
  "view.zoomIn": {
    id: "view.zoomIn",
    title: "Zoom in",
    category: "App",
    scope: "global",
    allowInInput: true,
    run: () => {
      useSettingsStore.getState().stepZoom(1);
      return true;
    },
  },
  "view.zoomOut": {
    id: "view.zoomOut",
    title: "Zoom out",
    category: "App",
    scope: "global",
    allowInInput: true,
    run: () => {
      useSettingsStore.getState().stepZoom(-1);
      return true;
    },
  },
  "view.zoomReset": {
    id: "view.zoomReset",
    title: "Reset zoom",
    category: "App",
    scope: "global",
    allowInInput: true,
    run: () => {
      useSettingsStore.getState().set("uiZoom", 1);
      return true;
    },
  },

  // The built-in terminal (#243). `allowInInput` because this is the ONE chord
  // that must work from inside the terminal itself — it is the way back out,
  // and xterm's textarea is an input as far as the dispatcher is concerned.
  "terminal.toggle": {
    id: "terminal.toggle",
    title: "Toggle terminal",
    category: "App",
    scope: "global",
    allowInInput: true,
    run: () => {
      useTerminalStore.getState().toggle();
      return true;
    },
  },

  "app.cheatSheet": {
    id: "app.cheatSheet",
    title: "Show keyboard shortcuts",
    category: "App",
    scope: "global",
    run: () => {
      useOverlayStore.getState().toggleCheatSheet();
      return true;
    },
  },
  "app.closeOverlay": {
    id: "app.closeOverlay",
    title: "Close overlay / cancel",
    category: "App",
    scope: "global",
    allowInInput: true,
    run: () => {
      if (useOverlayStore.getState().cheatSheetOpen) {
        useOverlayStore.getState().closeCheatSheet();
        return true;
      }
      // Between the cheat sheet (zIndex 1000, topmost) and the update panel
      // (zIndex 50, an anchored dropdown) in stacking order — PGModal's
      // backdrop is zIndex 100. Claim the chord even while busy: close()
      // no-ops mid-clone/init by design, and an unclaimed Escape must not
      // fall through to some other overlay action while a run is in flight.
      if (useCreateStore.getState().open !== "none") {
        useCreateStore.getState().close();
        return true;
      }
      // Same stacking layer (PGModal), same rule (#132).
      if (useCreateTagStore.getState().target) {
        useCreateTagStore.getState().close();
        return true;
      }
      if (useUpdateStore.getState().panelOpen) {
        useUpdateStore.getState().closePanel();
        return true;
      }
      return false; // nothing to close — let the key fall through
    },
  },

  // suppressInInput: Alt+Arrow is the caret's word/paragraph movement on
  // macOS — spatial pane traversal must not eat it while typing.
  "pane.focusLeft": { id: "pane.focusLeft", title: "Focus pane left", category: "Panes", scope: "global", suppressInInput: true, run: () => useFocusStore.getState().move("left") },
  "pane.focusRight": { id: "pane.focusRight", title: "Focus pane right", category: "Panes", scope: "global", suppressInInput: true, run: () => useFocusStore.getState().move("right") },
  "pane.focusUp": { id: "pane.focusUp", title: "Focus pane up", category: "Panes", scope: "global", suppressInInput: true, run: () => useFocusStore.getState().move("up") },
  "pane.focusDown": { id: "pane.focusDown", title: "Focus pane down", category: "Panes", scope: "global", suppressInInput: true, run: () => useFocusStore.getState().move("down") },
  "pane.focusNext": { id: "pane.focusNext", title: "Focus next pane", category: "Panes", scope: "global", run: cyclePane(1) },
  "pane.focusPrev": { id: "pane.focusPrev", title: "Focus previous pane", category: "Panes", scope: "global", run: cyclePane(-1) },

  "list.up": { id: "list.up", title: "Move selection up", category: "Lists & trees", scope: "pane" },
  "list.down": { id: "list.down", title: "Move selection down", category: "Lists & trees", scope: "pane" },
  "list.expand": { id: "list.expand", title: "Expand / move right", category: "Lists & trees", scope: "pane" },
  "list.collapse": { id: "list.collapse", title: "Collapse / move left", category: "Lists & trees", scope: "pane" },
  "list.activate": { id: "list.activate", title: "Activate selection", category: "Lists & trees", scope: "pane" },
  "list.toggle": { id: "list.toggle", title: "Toggle selection (stage/unstage)", category: "Lists & trees", scope: "pane" },
  "list.top": { id: "list.top", title: "Select first item", category: "Lists & trees", scope: "pane" },
  "list.bottom": { id: "list.bottom", title: "Select last item", category: "Lists & trees", scope: "pane" },
  "list.extendUp": { id: "list.extendUp", title: "Extend selection up", category: "Lists & trees", scope: "pane", suppressInInput: true },
  "list.extendDown": { id: "list.extendDown", title: "Extend selection down", category: "Lists & trees", scope: "pane", suppressInInput: true },

  "diff.nextChange": { id: "diff.nextChange", title: "Next change (hunk)", category: "Diff", scope: "pane" },
  "diff.prevChange": { id: "diff.prevChange", title: "Previous change (hunk)", category: "Diff", scope: "pane" },
  // Shares the Space chord with list.toggle, which is legal: both are
  // pane-scoped, so the dispatcher's pane filter picks exactly one of them (a
  // declined action falls through to the next id bound to the same chord). Its
  // own catalog entry rather than a second list.toggle handler, so the cheat
  // sheet says "Diff / stage the focused line" instead of hiding a diff action
  // under "Lists & trees", and so the two can be rebound apart.
  "diff.toggleLine": { id: "diff.toggleLine", title: "Stage / unstage focused line", category: "Diff", scope: "pane" },
  // #158. Shares Mod+D with the GLOBAL nav.diff, which is legal in exactly one
  // direction: this action is pane-scoped, so the dispatcher only offers it while
  // the History commit list holds focus, and when its handler declines the chord
  // falls through to nav.diff's default runner (presets.test.ts forbids two
  // GLOBAL actions on one chord, not this pairing — the same asymmetry that lets
  // Space mean list.toggle in a list and diff.toggleLine in a diff).
  //
  // Its own catalog entry rather than a second meaning hung off nav.diff, so the
  // cheat sheet names both behaviors and the two can be rebound apart.
  //
  // The handler (History.tsx) claims ANY non-empty commit selection — one commit
  // routes to its own diff, 2+ to the combined diff of the range, exactly as
  // Enter does (#164). It declines only on an empty log, which is what keeps the
  // fall-through to nav.diff alive there. The id keeps its "combined" spelling
  // (rebindings and presets.test.ts are keyed on it); the title does not, because
  // the single-commit case is not a combined anything.
  "diff.viewCombined": { id: "diff.viewCombined", title: "View diff of selected commits", category: "Diff", scope: "pane" },
  // The keyboard half of the hunk gutter cluster (#157). The `@@` banner's
  // Stage/Discard buttons were reachable by mouse only — Tab is pane traversal, so
  // DOM focus never enters a pane's buttons — and the cluster that replaced them
  // would have inherited that. Pane-scoped and registered by the two screens that
  // own hunk staging, against the hunk their F7 cursor (or line cursor) sits on;
  // no default runner, like the commit.* family.
  "diff.stageHunk": { id: "diff.stageHunk", title: "Stage / unstage hunk", category: "Diff", scope: "pane" },
  "diff.discardHunk": { id: "diff.discardHunk", title: "Discard hunk", category: "Diff", scope: "pane" },
  // Mod+C over a diff, and it must not stop meaning "copy".
  //
  // It exists because the diff surfaces are windowed: only the rendered rows are
  // in the document, so a mouse selection cannot reach past them, and there was
  // no way at all to copy a long range. This action copies the selected diff
  // LINES straight from the row model instead, so the length of the range is
  // irrelevant.
  //
  // Its handler DECLINES (returns false) whenever a text selection exists, and
  // whenever no lines are selected — declining leaves the chord unhandled, the
  // dispatcher skips preventDefault, and the webview's own copy runs on the
  // selection exactly as it would in any other app. Pane-scoped, so it is only
  // ever offered while a diff pane holds focus; `suppressInInput` keeps it away
  // from the commit-message textarea, where Mod+C is the caret's.
  "diff.copy": { id: "diff.copy", title: "Copy selected diff lines", category: "Diff", scope: "pane", suppressInInput: true },
  // Find in diff (#241). The webview's own ⌘F is useless here: the diff surfaces
  // are windowed, so native find would search the screenful that happens to be
  // mounted and answer "no results" for a match two thousand lines down. This
  // action opens a find bar that searches the ROW MODEL instead — the same reason
  // `diff.copy` exists one entry up.
  //
  // suppressInInput, and that is the whole answer to "⌘F must not steal the key
  // from an input that already wants it": the dispatcher never resolves a
  // suppressed action while focus sits in an INPUT/TEXTAREA/contentEditable, so
  // the commit-message box, the file filter and the find bar's OWN input all keep
  // whatever ⌘F means to them. Pane-scoped on top of that, so it is only ever
  // offered while a diff pane holds focus.
  "diff.find": { id: "diff.find", title: "Find in diff", category: "Diff", scope: "pane", suppressInInput: true },
  // Escape closes the find bar. Pane-scoped, which is what makes sharing Escape
  // with the GLOBAL app.closeOverlay legal (the same asymmetry as
  // diff.viewCombined vs nav.diff) — and the handler DECLINES when the bar is
  // shut, so Escape still reaches the overlay from a diff pane.
  //
  // allowInInput because the bar autofocuses its own input: a bare-key chord is
  // suppressed inside a text field unless the action opts in, and an Escape that
  // only worked after clicking away from the box would not close anything.
  "diff.closeFind": { id: "diff.closeFind", title: "Close the diff find bar", category: "Diff", scope: "pane", allowInInput: true },

  "repo.open": { id: "repo.open", title: "Open repository…", category: "Repository", scope: "global", run: openRepoOp },
  "repo.clone": { id: "repo.clone", title: "Clone repository…", category: "Repository", scope: "global", run: cloneRepoOp },
  "repo.init": { id: "repo.init", title: "New repository…", category: "Repository", scope: "global", run: initRepoOp },
  "repo.fetch": { id: "repo.fetch", title: "Fetch all remotes", category: "Repository", scope: "global", run: fetchAllOp },
  "repo.pull": { id: "repo.pull", title: "Pull (update project)", category: "Repository", scope: "global", run: pullCurrentOp },
  "repo.push": { id: "repo.push", title: "Push", category: "Repository", scope: "global", run: pushCurrentOp },
  // Undo/redo name the operation at DISPATCH time (the ops read the stack), so
  // the palette row here carries the generic title and the confirmation says
  // "Undo merge of feat/x?". Both runners return false when there is nothing to
  // undo, which lets Mod+Z fall through to the browser and still undo typing in
  // a text field — the behaviour anyone would expect from that chord.
  "repo.undo": { id: "repo.undo", title: "Undo last operation", category: "Repository", scope: "global", run: undoOp },
  "repo.redo": { id: "repo.redo", title: "Redo last undone operation", category: "Repository", scope: "global", run: redoOp },
  "repo.refresh": { id: "repo.refresh", title: "Refresh repository", category: "Repository", scope: "global", run: refreshOp },
  "repo.stageAll": { id: "repo.stageAll", title: "Stage all changes", category: "Repository", scope: "global", run: stageAllOp },
  "repo.unstageAll": { id: "repo.unstageAll", title: "Unstage all changes", category: "Repository", scope: "global", run: unstageAllOp },
  // Took over Mod+5 from the removed "Go to Conflicts" (#108) — same finger,
  // and now it opens the resolver window instead of a screen.
  "conflict.openResolver": { id: "conflict.openResolver", title: "Resolve conflicts", category: "Repository", scope: "global", run: resolveConflictsOp },

  // commit.* carry no default runners: the message/amend state is
  // CommitPanel component state, so the panel registers handlers while
  // mounted; on other screens the chords fall through.
  "commit.commit": { id: "commit.commit", title: "Commit staged changes", category: "Repository", scope: "global" },
  "commit.commitAndPush": { id: "commit.commitAndPush", title: "Commit and push", category: "Repository", scope: "global" },
  "commit.toggleAmend": { id: "commit.toggleAmend", title: "Toggle amend previous commit", category: "Repository", scope: "global" },

  "branch.createNew": {
    id: "branch.createNew",
    title: "Create branch…",
    category: "Repository",
    scope: "global",
    run: () => {
      if (!useRepoStore.getState().current) return false;
      usePaletteStore.getState().pushStep(createBranchInputStep());
      return true;
    },
  },

  // Keyboard parity for the rebase plan's drag reorder (#91). Component-handled
  // by the Rebase screen while its plan pane holds focus — and it DECLINES in
  // preserve mode, exactly as the drag and the chevrons do, so the chord falls
  // through rather than looking broken.
  "rebase.moveStepUp": {
    id: "rebase.moveStepUp",
    title: "Move rebase step up",
    category: "Repository",
    scope: "pane",
    suppressInInput: true,
  },
  "rebase.moveStepDown": {
    id: "rebase.moveStepDown",
    title: "Move rebase step down",
    category: "Repository",
    scope: "pane",
    suppressInInput: true,
  },

  // Opens the create form for the detected forge (#92). Declines when there is
  // no repo, or no forge with a token — the chord then falls through rather than
  // popping a dialog that cannot submit.
  "forge.createPr": {
    id: "forge.createPr",
    title: "Create pull request…",
    category: "Repository",
    scope: "global",
    run: () => {
      if (!useRepoStore.getState().current) return false;
      if (useForgeStore.getState().gate() !== "ready") return false;
      useForgeStore.getState().openCreate();
      useNavStore.getState().setIntent({ kind: "switch-screen", screen: "pulls" });
      return true;
    },
  },

  // ── repository tabs (#90) ────────────────────────────────────────────────
  // `repo.open` above is the "open in a new tab" action: openRepo means "open a
  // tab" everywhere now, so a second action for the same key would be two
  // cheat-sheet rows for one behavior.
  "tab.next": {
    id: "tab.next",
    title: "Next repository tab",
    category: "Repository",
    scope: "global",
    run: () => stepTab(1),
  },
  "tab.prev": {
    id: "tab.prev",
    title: "Previous repository tab",
    category: "Repository",
    scope: "global",
    run: () => stepTab(-1),
  },
  "tab.close": {
    id: "tab.close",
    title: "Close repository tab",
    category: "Repository",
    scope: "global",
    run: () => {
      const path = useTabsStore.getState().activePath;
      if (!path) return false;
      void useTabsStore.getState().close(path);
      return true;
    },
  },
  "tab.moveLeft": {
    id: "tab.moveLeft",
    title: "Move repository tab left",
    category: "Repository",
    scope: "global",
    run: () => moveActiveTab(-1),
  },
  "tab.moveRight": {
    id: "tab.moveRight",
    title: "Move repository tab right",
    category: "Repository",
    scope: "global",
    run: () => moveActiveTab(1),
  },
  "tab.select": {
    id: "tab.select",
    title: "Switch to repository 1–9",
    category: "Repository",
    scope: "global",
    // suppressInInput, for the same reason Alt+Arrow carries it: ⌥+digit is a
    // CHARACTER on macOS, and on Nordic layouts it is one people type (⌥1 "¡",
    // and the range covers ", @, £, $ neighbours). Claiming it while a commit
    // message, a filter box or the resolver's CodeMirror pane has focus would
    // silently eat the keystroke. `isEditable` in the dispatcher covers input,
    // textarea and contentEditable (CM6's editor), so all three are safe.
    suppressInInput: true,
    run: (chord) => {
      // Bound to Alt+1…Alt+9; the digit IS the argument. `eventToChord` takes
      // digits from `e.code`, so this is layout-independent. Optional because
      // the catalog's runners are also callable directly (tests, the palette).
      const n = Number((chord ?? "").slice((chord ?? "").lastIndexOf("+") + 1));
      if (!Number.isInteger(n) || n < 1 || n > 9) return false;
      if (!useTabsStore.getState().tabs[n - 1]) return false;
      void useTabsStore.getState().selectIndex(n);
      return true;
    },
  },
  "tab.switch": {
    id: "tab.switch",
    title: "Switch repository…",
    category: "Repository",
    scope: "global",
    run: () => {
      usePaletteStore.getState().pushStep(switchRepoStep());
      return true;
    },
  },

  // Component-handled: the Files tree registers a handler that focuses its
  // filter box while mounted (like commit.*). Elsewhere the chord falls through.
  "tree.find": {
    id: "tree.find",
    title: "Find in file tree",
    category: "Lists & trees",
    scope: "global",
  },
};

export const ALL_ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
