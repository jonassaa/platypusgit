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

import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import {
  fetchAllOp,
  pullCurrentOp,
  pushCurrentOp,
  refreshOp,
  stageAllOp,
  unstageAllOp,
} from "@/features/repo/ops";
import { useRepoStore } from "@/features/repo/useRepoStore";
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
  | "nav.conflict"
  | "nav.rebase"
  | "nav.remote"
  | "nav.diff"
  | "nav.reflog"
  | "nav.settings"
  | "palette.open"
  | "app.cheatSheet"
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
  | "diff.nextChange"
  | "diff.prevChange"
  | "commit.commit"
  | "commit.commitAndPush"
  | "commit.toggleAmend"
  | "branch.createNew"
  | "tree.find";

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
  "nav.conflict": { id: "nav.conflict", title: "Go to Conflicts", category: "Navigation", scope: "global", run: navTo("conflict") },
  "nav.rebase": { id: "nav.rebase", title: "Go to Rebase", category: "Navigation", scope: "global", run: navTo("rebase") },
  "nav.remote": { id: "nav.remote", title: "Go to Remotes", category: "Navigation", scope: "global", run: navTo("remote") },
  "nav.diff": { id: "nav.diff", title: "Go to Diff viewer", category: "Navigation", scope: "global", run: navTo("diff") },
  "nav.reflog": { id: "nav.reflog", title: "Go to Reflog", category: "Navigation", scope: "global", run: navTo("reflog") },
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

  "repo.fetch": { id: "repo.fetch", title: "Fetch all remotes", category: "Repository", scope: "global", run: fetchAllOp },
  "repo.pull": { id: "repo.pull", title: "Pull (update project)", category: "Repository", scope: "global", run: pullCurrentOp },
  "repo.push": { id: "repo.push", title: "Push", category: "Repository", scope: "global", run: pushCurrentOp },
  "repo.refresh": { id: "repo.refresh", title: "Refresh repository", category: "Repository", scope: "global", run: refreshOp },
  "repo.stageAll": { id: "repo.stageAll", title: "Stage all changes", category: "Repository", scope: "global", run: stageAllOp },
  "repo.unstageAll": { id: "repo.unstageAll", title: "Unstage all changes", category: "Repository", scope: "global", run: unstageAllOp },

  // commit.* carry no default runners: the message/body/amend state is
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
