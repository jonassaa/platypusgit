/**
 * Stage / Unstage drop targets that exist only while a files drag is in flight.
 *
 * The Files screen has one tree and no staged/unstaged sections, so unlike the
 * Commit screen it has nothing in its layout to drop onto. Rather than invent a
 * permanent second pane, the targets appear for the duration of the gesture and
 * vanish again — the tree keeps every pixel it had.
 *
 * NOTE: this bar is an explicit COMMAND surface, so it deliberately does NOT go
 * through `resolveStagingDrop`. That function's same-side no-op rule is about the
 * Commit screen's two lists, where dropping a row back where it came from is
 * meaningless. Here both zones are always meaningful — a Files-screen row can be
 * partially staged, so its payload has no single "side" to compare against, and
 * routing through that rule would make one zone permanently dead. Which paths are
 * actually actionable is decided by the caller's splitter, against live status.
 */

import { PGIcon } from "@/design";
// Direct module imports, not the barrel: the barrel re-exports this file, and
// going through it would make the cycle real.
import { useDragActive } from "./dragController";
import { useDropZone } from "./useDnd";
import type { DragPayload, FilesPayload } from "./types";

const acceptsFiles = (p: DragPayload) => p.kind === "files";

function Zone({
  side,
  onDrop,
}: {
  side: "staged" | "unstaged";
  onDrop: (d: { action: "stage" | "unstage"; paths: string[] }) => void;
}) {
  const stage = side === "staged";
  const { ref, isOver } = useDropZone({
    id: `files.drop.${side}`,
    accepts: acceptsFiles,
    onDrop: (p) => {
      const paths = (p as FilesPayload).paths;
      if (paths.length) onDrop({ action: stage ? "stage" : "unstage", paths });
    },
  });
  return (
    <div
      ref={ref}
      data-testid={stage ? "drop-stage" : "drop-unstage"}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 34,
        borderRadius: "var(--r-3)",
        border: `1px dashed ${isOver ? "var(--accent)" : "var(--border-1)"}`,
        background: "var(--bg-2)",
        color: isOver ? "var(--accent)" : "var(--fg-2)",
        fontSize: "var(--fs-11)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <PGIcon name={stage ? "plus" : "minus"} size={12} />
      {stage ? "Stage" : "Unstage"}
    </div>
  );
}

export function StageDropBar({
  onDrop,
}: {
  onDrop: (d: { action: "stage" | "unstage"; paths: string[] }) => void;
}) {
  // Subscribes to the payload's null ⇄ non-null flip only — twice per gesture.
  const active = useDragActive(acceptsFiles);
  if (!active) return null;
  return (
    <div
      data-testid="stage-drop-bar"
      style={{
        display: "flex",
        gap: 6,
        padding: 6,
        borderTop: "1px solid var(--border-0)",
        background: "var(--bg-1)",
        flexShrink: 0,
      }}
    >
      <Zone side="staged" onDrop={onDrop} />
      <Zone side="unstaged" onDrop={onDrop} />
    </div>
  );
}
