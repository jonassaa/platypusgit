// User-defined commands (#225) — the frontend model.
//
// The security-critical half lives in Rust (`custom_action.rs`): parsing the
// command string into argv and substituting placeholders into individual
// entries. Deliberately NOT duplicated here — a second parser would be a second
// place for "what actually runs" to drift, and the one that matters is the one
// next to the spawn.
//
// This file is the list, its validation, and what the palette shows.

import type { ActionContext } from "@/lib/types";

/** One user-defined command. */
export interface CustomAction {
  id: string;
  /** What appears in the palette. */
  name: string;
  /** Program + arguments, with placeholders. Parsed by the backend, not here. */
  command: string;
  /** Show the output afterwards even when it succeeds. */
  showOutput: boolean;
  /** Refresh the repository when it exits — for actions that change the tree. */
  refreshAfter: boolean;
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
  };
}

export function normalizeAction(a: CustomAction): CustomAction {
  return { ...a, name: a.name.trim(), command: a.command.trim() };
}

/**
 * Whether an action is worth saving.
 *
 * Name and command non-blank, and nothing else. Whether the command PARSES is
 * the backend's question — it owns the parser, and its refusal names what is
 * wrong ("unclosed quote", "trailing backslash"). Re-implementing that check
 * here would create exactly the drift this file's header warns about.
 */
export function isSavableAction(a: CustomAction): boolean {
  const n = normalizeAction(a);
  return n.name !== "" && n.command !== "";
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
  return { repo: "", files: [], sha: null, branch };
}
