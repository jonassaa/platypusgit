// Running a user-defined command (#225).
//
// Separate from the palette entry and from Settings so "what happens when an
// action runs" is one place: spawn, report, refresh.

import { pgAlert, pgFlash } from "@/design";
import { setActivity, useRepoStore } from "@/features/repo/useRepoStore";
import { appErrorMessage } from "@/lib/errors";
import { runCustomAction } from "@/lib/tauri";
import type { ActionContext, ActionOutput } from "@/lib/types";

import {
  describeResult,
  repoContext,
  shouldShowOutput,
  type CustomAction,
} from "./customActions";

/**
 * What the output panel shows.
 *
 * The argv comes first because "what did it actually run" is the question a
 * surprising result raises, and it cannot be answered by re-reading the command
 * string — that string is a template, and the argv is the result.
 */
export function formatOutput(action: CustomAction, out: ActionOutput): string {
  const parts = [
    out.argv.join(" "),
    "",
    describeResult(action, out.code),
  ];
  if (out.stdout.trim()) parts.push("", out.stdout.trimEnd());
  if (out.stderr.trim()) parts.push("", out.stderr.trimEnd());
  return parts.join("\n");
}

/**
 * Run `action` against the open repository.
 *
 * Returns false when there was nothing to run against, so a keymap runner can
 * decline cleanly.
 *
 * The action is announced while it runs through `RepoActivity`, per the rule
 * that a new long-running op joins it: a user command can take as long as it
 * likes, and one that silently pins nothing visible is indistinguishable from
 * one that never started.
 */
export async function runAction(
  action: CustomAction,
  context?: Partial<ActionContext>,
): Promise<boolean> {
  const store = useRepoStore.getState();
  const repo = store.current;
  if (!repo) return false;

  const ctx: ActionContext = {
    ...repoContext(store.headInfo?.branch ?? null),
    ...context,
  };

  setActivity(repo.id, "action", `Running ${action.name}…`);
  try {
    const out = await runCustomAction(repo.id, action.command, ctx);
    if (shouldShowOutput(action, out.code)) {
      await pgAlert({
        title: describeResult(action, out.code),
        body: formatOutput(action, out),
      });
    } else {
      pgFlash(describeResult(action, out.code));
    }
    // After the dialog, not before: an action that changed the tree should
    // leave the app showing the new state once the user is done reading.
    if (action.refreshAfter) await useRepoStore.getState().refreshAll();
  } catch (e) {
    // A refusal from the backend — an unparseable command, a program that is
    // not on PATH. It names the problem, so show it rather than a toast that
    // scrolls away.
    await pgAlert({
      title: `${action.name} could not run`,
      body: appErrorMessage(e),
    });
  } finally {
    setActivity(repo.id, "action", null);
  }
  return true;
}
