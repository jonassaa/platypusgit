// SidePane — read-only OURS / THEIRS column for the merge resolver body.
// Renders every line as one uniform-height <div data-line> (monospace, no
// wrap) so the middle-pane scroll-sync can map by line index. Conflict lines
// are tinted; each conflict's first line (or a phantom ∅ row when the side
// deleted the lines) carries an accept chevron in the gutter.

import React from "react";
import type { ConflictRegion } from "./mergeModel";
import type { RegionState } from "./resultEditor";

const CONFLICT_BG = "oklch(0.72 0.15 325 / 0.12)";
const RESOLVED_BG = "oklch(0.72 0.15 155 / 0.07)";

type Row =
  | { kind: "line"; index: number }
  | { kind: "phantom"; conflictId: number };

function sideRange(side: "ours" | "theirs", c: ConflictRegion): { start: number; count: number } {
  const s = side === "ours" ? c.ours : c.theirs;
  return { start: s.start, count: s.lines.length };
}

export function SidePane({
  side,
  lines,
  conflicts,
  regionStates,
  currentConflict,
  onAccept,
  scrollRef,
  onScroll,
}: {
  side: "ours" | "theirs";
  lines: string[];
  conflicts: ConflictRegion[];
  regionStates: RegionState[];
  currentConflict: number | null;
  onAccept: (id: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}): React.JSX.Element {
  const label = side === "ours" ? "YOURS" : "THEIRS";
  const headerColor = side === "ours" ? "var(--accent)" : "var(--accent-2, var(--fg-1))";
  const chevron = side === "ours" ? "≫" : "≪"; // ≫ take ours / ≪ take theirs

  const resolvedById = React.useMemo(() => {
    const m = new Map<number, boolean>();
    for (const r of regionStates) m.set(r.id, r.resolution != null);
    return m;
  }, [regionStates]);

  // Per-line: which conflict owns it (or null); which conflict starts here.
  const { lineOwner, firstLineOf, rows } = React.useMemo(() => {
    const owner: (number | null)[] = new Array(lines.length).fill(null);
    const first = new Map<number, number>(); // line index -> conflict id
    const zeroByStart = new Map<number, number[]>(); // start line -> conflict ids
    for (const c of conflicts) {
      const { start, count } = sideRange(side, c);
      if (count === 0) {
        const arr = zeroByStart.get(start) ?? [];
        arr.push(c.id);
        zeroByStart.set(start, arr);
        continue;
      }
      for (let k = 0; k < count; k++) {
        if (start + k < owner.length) owner[start + k] = c.id;
      }
      first.set(start, c.id);
    }
    const rowList: Row[] = [];
    for (let i = 0; i <= lines.length; i++) {
      for (const id of zeroByStart.get(i) ?? []) rowList.push({ kind: "phantom", conflictId: id });
      if (i < lines.length) rowList.push({ kind: "line", index: i });
    }
    return { lineOwner: owner, firstLineOf: first, rows: rowList };
  }, [side, lines.length, conflicts]);

  function rowStyle(conflictId: number | null): React.CSSProperties {
    if (conflictId == null) {
      return { borderLeft: "2px solid transparent" };
    }
    const resolved = resolvedById.get(conflictId) ?? false;
    return {
      background: resolved ? RESOLVED_BG : CONFLICT_BG,
      borderLeft:
        currentConflict === conflictId ? "2px solid var(--accent)" : "2px solid transparent",
    };
  }

  function chevronButton(id: number) {
    const resolved = resolvedById.get(id) ?? false;
    return (
      <button
        type="button"
        data-testid={side === "ours" ? `accept-chevron-ours-${id}` : `accept-chevron-theirs-${id}`}
        disabled={resolved}
        onClick={() => onAccept(id)}
        title={side === "ours" ? "Take our version" : "Take their version"}
        style={{
          all: "unset",
          cursor: resolved ? "default" : "pointer",
          color: resolved ? "var(--fg-3, var(--fg-2))" : "var(--accent)",
          opacity: resolved ? 0.4 : 1,
          fontSize: "var(--fs-12)",
          lineHeight: 1,
        }}
      >
        {chevron}
      </button>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-10)",
          color: headerColor,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          borderBottom: "1px solid var(--border-0)",
        }}
      >
        {label}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid={`merge-side-${side}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          lineHeight: "var(--lh-code)",
          whiteSpace: "pre",
        }}
      >
        {rows.map((row) => {
          if (row.kind === "phantom") {
            const id = row.conflictId;
            return (
              <div
                key={`p${id}`}
                data-line
                style={{ display: "flex", ...rowStyle(id) }}
              >
                <span style={{ flex: "0 0 18px", textAlign: "center" }}>{chevronButton(id)}</span>
                <span style={{ flex: 1, opacity: 0.5 }}>{"∅"}</span>
              </div>
            );
          }
          const i = row.index;
          const owner = lineOwner[i];
          const startsHere = firstLineOf.get(i);
          return (
            <div key={`l${i}`} data-line style={{ display: "flex", ...rowStyle(owner) }}>
              <span style={{ flex: "0 0 18px", textAlign: "center" }}>
                {startsHere != null ? chevronButton(startsHere) : null}
              </span>
              <span style={{ flex: 1 }}>{lines[i] === "" ? " " : lines[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
