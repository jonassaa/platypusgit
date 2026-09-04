/**
 * The "out of a folder" half of the branch-folder drag (#244).
 *
 * Dropping a branch ONTO a folder row has an obvious target; dropping it back
 * out has none — the Branches screen is one grid with no root header to aim at.
 * So the target appears for the duration of the gesture and vanishes again,
 * exactly like `StageDropBar` does for the Files screen. The list keeps every
 * pixel it had.
 *
 * Shown only for a drag this bar can actually serve: a LOCAL branch that is
 * currently inside a folder. A remote-tracking ref, or a branch already at the
 * top level, would make it a dead target — the folder rows are where those
 * drags get their explanation.
 */

import React from "react";
import { PGIcon } from "@/design";
import {
  resolveBranchMoveDrop,
  useDragActive,
  useDropZone,
  type BranchMove,
  type DragPayload,
} from "@/features/dnd";

export interface BranchFolderDropBarProps {
  /** Every local branch name — the resolver's legality context. */
  local: readonly string[];
  onMove: (move: { from: string; to: string }) => void;
  onReject: (reason: string) => void;
}

export function BranchFolderDropBar({
  local,
  onMove,
  onReject,
}: BranchFolderDropBarProps) {
  const accepts = React.useCallback(
    (p: DragPayload) =>
      p.kind === "ref" && p.ref.includes("/") && local.includes(p.ref),
    [local],
  );
  // Subscribes to the payload's null ⇄ non-null flip only — twice per gesture.
  const active = useDragActive(accepts);
  const { ref, isOver } = useDropZone({
    id: "branches.drop.root",
    accepts,
    // A rename can still collide at the top level (`feat/main` → `main`), so
    // this resolves rather than accepting blindly, and the ghost says why.
    resolve: (el, p) => {
      const drop = resolveBranchMoveDrop(p, { kind: "root" }, { local });
      if (!drop) return null;
      // The mark belongs on the BAR, not on whatever child the pointer landed
      // on — `[data-pg-drop-over]` paints the element it is written to.
      const zone = (el.closest("[data-pg-drop-id]") as HTMLElement | null) ?? el;
      if (drop.kind === "rejected") return { key: "", el: zone, reason: drop.reason };
      return { key: JSON.stringify(drop), el: zone };
    },
    onDrop: (_p, key) => {
      if (!key) return;
      const drop = JSON.parse(key) as BranchMove;
      if (drop.kind === "move") onMove({ from: drop.from, to: drop.to });
    },
    onReject: (_p, reason) => onReject(reason),
  });

  if (!active) return null;
  return (
    <div
      ref={ref}
      data-testid="branch-root-drop"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 34,
        margin: 6,
        borderRadius: "var(--r-3)",
        border: `1px dashed ${isOver ? "var(--accent)" : "var(--border-1)"}`,
        background: "var(--bg-2)",
        color: isOver ? "var(--accent)" : "var(--fg-2)",
        fontSize: "var(--fs-11)",
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}
    >
      <PGIcon name="chevronLeft" size={12} />
      Move out of its folder
    </div>
  );
}
