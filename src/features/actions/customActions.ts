// User-defined commands (#225) — the frontend model.
//
// The security-critical half lives in Rust (`custom_action.rs`): parsing the
// command string into argv and substituting placeholders into individual
// entries. Deliberately NOT duplicated here — a second parser would be a second
// place for "what actually runs" to drift, and the one that matters is the one
// next to the spawn.
//
// This file is the list, its validation, WHERE each action shows up
// (`ActionSurface`), and the `ActionContext` each surface hands it.

import type { ActionContext } from "@/lib/types";

/**
 * Where an action shows up.
 *
 * The issue's own three (#225): "repo-level, file context menu, commit context
 * menu". `repo` is the command palette — the app's repo-level surface, where
 * every op that is not about one file or one commit already lives.
 */
export type ActionSurface = (typeof ACTION_SURFACES)[number];

/**
 * The surfaces, in the order they are offered and stored.
 *
 * One list, so the Settings toggles, the normalizer and the canonical order a
 * saved action is written in cannot drift apart.
 */
export const ACTION_SURFACES = ["repo", "file", "commit"] as const;

/** What each surface is called where the user picks it. */
export const SURFACE_LABELS: Record<ActionSurface, string> = {
  repo: "Command palette",
  file: "File menu",
  commit: "Commit menu",
};

/**
 * What an action shows up on when it does not say.
 *
 * THE MIGRATION for #225's first half: every action persisted before this
 * existed was a palette action and nothing else, so an absent `surfaces` means
 * exactly that. Anything else would silently move a saved action — either into
 * menus its owner never asked for, or out of the palette they have been running
 * it from.
 */
export const DEFAULT_SURFACES: readonly ActionSurface[] = ["repo"];

/** One user-defined command. */
export interface CustomAction {
  id: string;
  /** What appears in the palette and on the menus it is placed on. */
  name: string;
  /** Program + arguments, with placeholders. Parsed by the backend, not here. */
  command: string;
  /** Show the output afterwards even when it succeeds. */
  showOutput: boolean;
  /** Refresh the repository when it exits — for actions that change the tree. */
  refreshAfter: boolean;
  /**
   * Where it shows up. Never empty for a saved action — see
   * `normalizeSurfaces` and `isSavableAction`.
   */
  surfaces: ActionSurface[];
}

/** The placeholders the backend substitutes, for the Settings hint. */
export const PLACEHOLDERS = ["$REPO", "$FILE", "$FILES", "$SHA", "$BRANCH"] as const;

let seq = 0;

export function newActionId(): string {
  seq += 1;
  return `act-${Date.now().toString(36)}-${seq}`;
}

export function blankAction(): CustomAction {
  return {
    id: newActionId(),
    name: "",
    command: "",
    showOutput: true,
    refreshAfter: true,
    surfaces: [...DEFAULT_SURFACES],
  };
}

/**
 * Coerce a stored or hand-edited surface list into a usable one.
 *
 * Unknown entries are dropped rather than kept: they name a surface this build
 * has no menu for, and carrying them would make `showsOn` answer questions
 * about a place that does not exist. Duplicates collapse, and the result is in
 * `ACTION_SURFACES` order so two actions ticked the same way compare equal —
 * which is what lets the settings export diff cleanly.
 *
 * A value that is not a list at all is the pre-#225-second-half shape, and
 * gets `DEFAULT_SURFACES`. A list that is empty AFTER filtering stays empty:
 * the caller decides whether that is a draft to refuse (`isSavableAction`) or
 * a persisted value to repair (`coerceCustomActions`), and those are different
 * answers.
 */
export function normalizeSurfaces(value: unknown): ActionSurface[] {
  if (!Array.isArray(value)) return [...DEFAULT_SURFACES];
  return ACTION_SURFACES.filter((s) => value.includes(s));
}

export function normalizeAction(a: CustomAction): CustomAction {
  return {
    ...a,
    name: a.name.trim(),
    command: a.command.trim(),
    surfaces: normalizeSurfaces(a.surfaces),
  };
}

/** Whether `a` is offered on `surface`. */
export function showsOn(a: CustomAction, surface: ActionSurface): boolean {
  return normalizeSurfaces(a.surfaces).includes(surface);
}

/** The actions offered on `surface`, in list order. */
export function actionsFor(
  list: readonly CustomAction[],
  surface: ActionSurface,
): CustomAction[] {
  return list.filter((a) => showsOn(a, surface));
}

/**
 * Repair a persisted or imported action list.
 *
 * Its own normalizer for the same reason `customThemes` and `themePreference`
 * have one: `coerceSettings`' type-guard compares against
 * `typeof DEFAULTS[key]`, and every object-valued setting is `"object"` — so
 * the whole list arrives from localStorage exactly as it was written, unread.
 * That is where an action saved before `surfaces` existed lands.
 *
 * Same rules as the rest of the settings coercion: an entry that is not an
 * action at all is dropped, and a field that is present but unusable falls back
 * to the documented safe value. An action ticked into NO surface is exactly
 * that case — it can only come from a hand-edited file, since the editor
 * refuses to save one — and the safe repair is the palette, which is where an
 * action nobody placed has always lived.
 *
 * Returns null when the value is not a list at all, so the caller falls back to
 * its own default the way `normalizeHeadMarks` lets it.
 */
export function coerceCustomActions(value: unknown): CustomAction[] | null {
  if (!Array.isArray(value)) return null;
  const out: CustomAction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    // The id has to survive: it is what `upsertAction` and the palette entry
    // are keyed by, and an action without one can neither be edited nor removed.
    if (typeof o.id !== "string" || !o.id) continue;
    if (typeof o.name !== "string" || typeof o.command !== "string") continue;
    const surfaces = normalizeSurfaces(o.surfaces);
    out.push(
      normalizeAction({
        id: o.id,
        name: o.name,
        command: o.command,
        // Absent reads as ON for both, which is what `blankAction` chose: an
        // action that silently shows nothing and silently refreshes nothing is
        // the pair of surprises this feature was written to avoid.
        showOutput: o.showOutput !== false,
        refreshAfter: o.refreshAfter !== false,
        surfaces: surfaces.length ? surfaces : [...DEFAULT_SURFACES],
      }),
    );
  }
  return out;
}

/**
 * Whether an action is worth saving.
 *
 * Name and command non-blank, and at least one surface. Whether the command
 * PARSES is the backend's question — it owns the parser, and its refusal names
 * what is wrong ("unclosed quote", "trailing backslash"). Re-implementing that
 * check here would create exactly the drift this file's header warns about.
 */
export function isSavableAction(a: CustomAction): boolean {
  const n = normalizeAction(a);
  // A surface is required for the opposite reason the parse check is absent:
  // this one CAN be answered here, and the answer matters — an action placed
  // nowhere is one that exists in Settings and can never be run. Refusing the
  // save leaves the cause on screen (three empty toggles) instead of quietly
  // putting a surface back that the user just unticked.
  return n.name !== "" && n.command !== "" && n.surfaces.length > 0;
}

export function upsertAction(
  list: readonly CustomAction[],
  a: CustomAction,
): CustomAction[] {
  const next = normalizeAction(a);
  const i = list.findIndex((x) => x.id === next.id);
  if (i === -1) return [...list, next];
  const copy = [...list];
  copy[i] = next;
  return copy;
}

export function removeAction(
  list: readonly CustomAction[],
  id: string,
): CustomAction[] {
  return list.filter((a) => a.id !== id);
}

/**
 * How an action's result should be reported.
 *
 * A failure is always shown, whatever `showOutput` says: an action that exits
 * non-zero and says nothing is indistinguishable from one that did not run, and
 * that is the state people file bugs about.
 */
export function shouldShowOutput(action: CustomAction, code: number | null): boolean {
  return action.showOutput || code !== 0;
}

/**
 * The one-line result summary.
 *
 * Names the exit code because "it failed" is not actionable and `exit 2` often
 * is — many tools document their codes.
 */
export function describeResult(action: CustomAction, code: number | null): string {
  if (code === 0) return `${action.name} finished.`;
  if (code === null) return `${action.name} was terminated.`;
  return `${action.name} exited with code ${code}.`;
}

/** The context an action gets when invoked with nothing selected. */
export function repoContext(branch: string | null): ActionContext {
  // `repo` is filled in by the BACKEND from the repository it resolves, so the
  // frontend cannot point a child process at a directory of its choosing.
  // `run_custom_action` overwrites whatever arrives here, so filling it in on
  // this side would be a second source of truth for where a repository lives
  // that nothing ever reads — and the two builders below inherit that.
  return { repo: "", files: [], sha: null, branch };
}

/**
 * The context an action gets from a file selection — `$FILE` and `$FILES`.
 *
 * Blank paths are dropped rather than passed through: `$FILE` expands to the
 * FIRST file, so one empty string at the head of the list turns a real
 * invocation into `code -g ""`, which fails somewhere far from the cause.
 */
export function fileContext(
  branch: string | null,
  files: readonly string[],
): ActionContext {
  return {
    ...repoContext(branch),
    files: files.filter((p) => !!p && !!p.trim()),
  };
}

/**
 * The context an action gets from one commit — `$SHA`.
 *
 * Null rather than `""` for a missing sha, so the backend expands `$SHA` to an
 * empty argument by its own documented rule instead of by accident.
 */
export function commitContext(
  branch: string | null,
  sha: string | null,
): ActionContext {
  return { ...repoContext(branch), sha: sha || null };
}
