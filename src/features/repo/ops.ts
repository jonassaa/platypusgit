// Store-level repository operations shared by the titlebar buttons, the
// command palette, and keymap default runners. Each op returns `true` when it
// ran and `false` when it declined (no repo / no upstream), so keymap runners
// can fall through cleanly.

import { open } from "@tauri-apps/plugin-dialog";
import { pgFlash } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { currentBranch, isStaged, isUnstaged } from "@/lib/derive";
import type { FileStatus } from "@/lib/types";
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

/** Show the native folder picker and open the chosen repository. Shared by the
 *  titlebar/Welcome buttons and the ⌘O keymap action so all three agree. */
export async function openRepoDialog(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open repository",
  });
  if (typeof selected === "string") {
    await useRepoStore.getState().openRepo(selected);
  }
}

/** Keymap runner form of {@link openRepoDialog}. Always claims the chord. */
export function openRepoOp(): boolean {
  void openRepoDialog();
  return true;
}

export function fetchAllOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  void repo.fetchAll();
  return true;
}

/**
 * Paths to stage from a change list: every unstaged entry except embedded git
 * repositories, which cannot be staged as files (see FileStatus.embedded).
 * Flashes once when something was left out, so the count silently shrinking
 * doesn't look like a bug. The backend skips them too — this is so the user
 * hears about it.
 */
export function stageablePaths(files: FileStatus[]): string[] {
  const unstaged = files.filter(isUnstaged);
  const embedded = unstaged.filter((f) => f.embedded);
  if (embedded.length > 0) {
    pgFlash(
      `Skipped ${embedded.length} embedded git ${
        embedded.length === 1 ? "repository" : "repositories"
      } — add to .gitignore or register as a submodule`,
    );
  }
  return unstaged.filter((f) => !f.embedded).map((f) => f.path);
}

export function stageAllOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  const paths = stageablePaths(repo.status);
  if (paths.length === 0) return false;
  void repo.stage(paths);
  return true;
}

export function unstageAllOp(): boolean {
  const repo = useRepoStore.getState();
  if (!repo.current) return false;
  const paths = repo.status.filter(isStaged).map((f) => f.path);
  if (paths.length === 0) return false;
  void repo.unstage(paths);
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
