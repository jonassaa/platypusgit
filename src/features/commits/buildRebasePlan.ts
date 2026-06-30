import type { CommitInfo, RebaseStep, RebaseAction } from "@/lib/types";

/**
 * Build a rebase plan covering the commits strictly newer than `fromOid` up to
 * HEAD (the first entry in `commits`). `commits` is newest-first (from the log);
 * git's rebase-todo format wants oldest-first so we reverse internally.
 *
 * `mode`:
 *   - "edit-from": every commit is a plain pick (equivalent to `rebase -i fromOid^`).
 *   - { kind: "fixup", targetOid }: target becomes "fixup".
 *   - { kind: "squash", targetOid, message }: target becomes "squash" with a custom message.
 *
 * Returns null when the `fromOid` isn't in the rebaseable range.
 */
export function buildRebasePlan(
  commits: CommitInfo[],
  fromOid: string,
  mode:
    | { kind: "edit-from" }
    | { kind: "fixup"; targetOid: string }
    | { kind: "squash"; targetOid: string; message: string },
): RebaseStep[] | null {
  const idx = commits.findIndex((c) => c.oid === fromOid);
  if (idx < 0) return null;
  const newestFirst = commits.slice(0, idx);
  const oldestFirst = newestFirst.slice().reverse();

  return oldestFirst.map((c): RebaseStep => {
    let action: RebaseAction = "Pick";
    let message: string | null = null;
    if (mode.kind === "fixup" && c.oid === mode.targetOid) {
      action = "Fixup";
    } else if (mode.kind === "squash" && c.oid === mode.targetOid) {
      action = "Squash";
      message = mode.message;
    }
    return { oid: c.oid, action, message };
  });
}
