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
 *   - { kind: "squash-range", oids, message }: collapse a contiguous selection
 *     into one commit — the oldest selected oid stays "pick", every other
 *     selected oid becomes "squash" carrying `message`; commits outside the
 *     selection (newer than it) stay "pick". The backend squash re-parents each
 *     squashed commit onto the previous one, so the run collapses to a single
 *     commit with `message`.
 *
 * Returns null when the `fromOid` isn't in the rebaseable range.
 */
export function buildRebasePlan(
  commits: CommitInfo[],
  fromOid: string,
  mode:
    | { kind: "edit-from" }
    | { kind: "fixup"; targetOid: string }
    | { kind: "squash"; targetOid: string; message: string }
    | { kind: "squash-range"; oids: string[]; message: string },
): RebaseStep[] | null {
  const idx = commits.findIndex((c) => c.oid === fromOid);
  if (idx < 0) return null;
  const newestFirst = commits.slice(0, idx);
  const oldestFirst = newestFirst.slice().reverse();

  // For a range squash, the oldest selected commit anchors the squash (stays a
  // pick); the rest fold into it. `oldestFirst` is ancestry order, so the first
  // selected entry it contains is the oldest.
  const rangeSet = mode.kind === "squash-range" ? new Set(mode.oids) : null;
  const rangeAnchor =
    rangeSet != null
      ? (oldestFirst.find((c) => rangeSet.has(c.oid))?.oid ?? null)
      : null;

  return oldestFirst.map((c): RebaseStep => {
    let action: RebaseAction = "Pick";
    let message: string | null = null;
    if (mode.kind === "fixup" && c.oid === mode.targetOid) {
      action = "Fixup";
    } else if (mode.kind === "squash" && c.oid === mode.targetOid) {
      action = "Squash";
      message = mode.message;
    } else if (
      mode.kind === "squash-range" &&
      rangeSet!.has(c.oid) &&
      c.oid !== rangeAnchor
    ) {
      action = "Squash";
      message = mode.message;
    }
    return { oid: c.oid, action, message };
  });
}
