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
import { useForgeStore } from "@/features/forge/useForgeStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import {
  cloneRepoOp,
  fetchAllOp,
  initRepoOp,
  openRepoOp,
  pullCurrentOp,
  pushCurrentOp,
  refreshOp,
  resolveConflictsOp,
  stageAllOp,
  unstageAllOp,
} from "@/features/repo/ops";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { createBranchInputStep } from "@/features/palette/steps";
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
  | "repo.refresh"
  | "repo.stageAll"
  | "repo.unstageAll"
  | "conflict.openResolver"
  | "diff.nextChange"
  | "diff.prevChange"
  | "diff.toggleLine"
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
  | "forge.createPr";

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
   *  Return `false` to decline. */
  run?: () => boolean | void;
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

  "repo.open": { id: "repo.open", title: "Open repository…", category: "Repository", scope: "global", run: openRepoOp },
  "repo.clone": { id: "repo.clone", title: "Clone repository…", category: "Repository", scope: "global", run: cloneRepoOp },
  "repo.init": { id: "repo.init", title: "New repository…", category: "Repository", scope: "global", run: initRepoOp },
  "repo.fetch": { id: "repo.fetch", title: "Fetch all remotes", category: "Repository", scope: "global", run: fetchAllOp },
  "repo.pull": { id: "repo.pull", title: "Pull (update project)", category: "Repository", scope: "global", run: pullCurrentOp },
  "repo.push": { id: "repo.push", title: "Push", category: "Repository", scope: "global", run: pushCurrentOp },
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
