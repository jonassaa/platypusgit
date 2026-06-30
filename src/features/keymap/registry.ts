// Action catalog — the single source of truth for every bindable action.
// Screens dispatch action ids; they never read raw key events. Keymap presets
// map chords onto these ids (see presets.ts).

export type ActionScope = "global" | "pane";
export type ActionCategory =
  | "Navigation"
  | "Panes"
  | "Lists & trees"
  | "Repository"
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
  | "app.cheatSheet"
  | "app.closeOverlay"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.focusUp"
  | "pane.focusDown"
  | "list.up"
  | "list.down"
  | "list.expand"
  | "list.collapse"
  | "list.activate"
  | "repo.fetch"
  | "repo.pull"
  | "repo.push";

export interface ActionDef {
  id: ActionId;
  title: string;
  category: ActionCategory;
  scope: ActionScope;
  /** When true the dispatcher still resolves this action inside text inputs
   *  (e.g. Escape). All other actions are suppressed while typing. */
  allowInInput?: boolean;
}

function def(
  id: ActionId,
  title: string,
  category: ActionCategory,
  scope: ActionScope,
  allowInInput = false,
): ActionDef {
  return { id, title, category, scope, allowInInput };
}

export const ACTIONS: Record<ActionId, ActionDef> = {
  "nav.files": def("nav.files", "Go to Files", "Navigation", "global"),
  "nav.commit": def("nav.commit", "Go to Commit", "Navigation", "global"),
  "nav.history": def("nav.history", "Go to History", "Navigation", "global"),
  "nav.branches": def("nav.branches", "Go to Branches", "Navigation", "global"),
  "nav.conflict": def("nav.conflict", "Go to Conflicts", "Navigation", "global"),
  "nav.rebase": def("nav.rebase", "Go to Rebase", "Navigation", "global"),
  "nav.remote": def("nav.remote", "Go to Remotes", "Navigation", "global"),
  "nav.diff": def("nav.diff", "Go to Diff viewer", "Navigation", "global"),
  "nav.reflog": def("nav.reflog", "Go to Reflog", "Navigation", "global"),
  "nav.settings": def("nav.settings", "Open Settings", "Navigation", "global"),
  "app.cheatSheet": def(
    "app.cheatSheet",
    "Show keyboard shortcuts",
    "App",
    "global",
  ),
  "app.closeOverlay": def(
    "app.closeOverlay",
    "Close overlay / cancel",
    "App",
    "global",
    true,
  ),
  "pane.focusLeft": def("pane.focusLeft", "Focus pane left", "Panes", "pane"),
  "pane.focusRight": def(
    "pane.focusRight",
    "Focus pane right",
    "Panes",
    "pane",
  ),
  "pane.focusUp": def("pane.focusUp", "Focus pane up", "Panes", "pane"),
  "pane.focusDown": def("pane.focusDown", "Focus pane down", "Panes", "pane"),
  "list.up": def("list.up", "Move selection up", "Lists & trees", "pane"),
  "list.down": def("list.down", "Move selection down", "Lists & trees", "pane"),
  "list.expand": def(
    "list.expand",
    "Expand / move right",
    "Lists & trees",
    "pane",
  ),
  "list.collapse": def(
    "list.collapse",
    "Collapse / move left",
    "Lists & trees",
    "pane",
  ),
  "list.activate": def(
    "list.activate",
    "Activate selection",
    "Lists & trees",
    "pane",
  ),
  "repo.fetch": def("repo.fetch", "Fetch", "Repository", "global"),
  "repo.pull": def("repo.pull", "Pull", "Repository", "global"),
  "repo.push": def("repo.push", "Push", "Repository", "global"),
};

export const ALL_ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
