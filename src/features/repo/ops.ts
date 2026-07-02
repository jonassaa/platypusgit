// Store-level repository operations shared by the titlebar buttons, the
// command palette, and keymap default runners. Each op returns `true` when it
// ran and `false` when it declined (no repo / no upstream), so keymap runners
// can fall through cleanly.

import { pgFlash } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { currentBranch } from "@/lib/derive";
import { useRepoStore } from "./useRepoStore";

/** Derive the [remote, branch] pair from the HEAD branch's upstream tracking ref. */
export function headUpstream(
  upstream: string | null | undefined,
  headName: string | undefined,
): [string, string] | null {
  if (!upstream) return null;
  const idx = upstream.indexOf("/");
  if (idx < 0) return [upstream, headName ?? upstream];
  return [upstream.slice(0, idx), upstream.slice(idx + 1)];
}

export function fetchAllOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  void repo.fetchAll();
  return true;
}

export function refreshOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  void repo.refreshAll();
  return true;
}

export function pullCurrentOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  const head = currentBranch(repo.branches);
  const upstream = headUpstream(head?.upstream, head?.name);
  if (!upstream) {
    pgFlash("No upstream configured for current branch");
    return true; // claimed: user got feedback
  }
  void repo.pull(upstream[0], upstream[1], useSettingsStore.getState().defaultPullMode);
  return true;
}

export function pushCurrentOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  const head = currentBranch(repo.branches);
  const upstream = headUpstream(head?.upstream, head?.name);
  if (!upstream) {
    pgFlash("No upstream configured — run git push -u origin <branch> first");
    return true;
  }
  void repo.push(upstream[0], upstream[1]);
  return true;
}
