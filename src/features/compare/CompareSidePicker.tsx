// The compare bar's side chip + its popover (#131).
//
// Deliberately NOT a generalisation of `RebaseBasePicker`: that one yields an
// OID and a rebase-specific label ("a1b2c3 — subject"), and this one must yield
// a REVSPEC — so the header keeps reading `main`, and a re-read after a fetch
// follows the ref rather than pinning the commit it pointed at — plus
// `Working tree`, which has no oid at all.

import React from "react";
import ReactDOM from "react-dom";

import { PGIcon, PGSearchInput, type IconName } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import {
  WORKDIR,
  WORKDIR_LABEL,
  sideLabel,
  type CompareSide,
} from "./compareSides";

const WIDTH = 380;
const MAX_HEIGHT = 460;

interface Row {
  /** Section heading this row belongs to. */
  group: string;
  side: CompareSide;
  label: string;
  detail?: string;
  icon: IconName;
}

interface Props {
  side: CompareSide;
  onPick: (side: CompareSide) => void;
  /** Only the right side may be the working tree — see `swapSides`. */
  allowWorkdir?: boolean;
  testId: string;
  label: string;
}

export function CompareSidePicker({
  side,
  onPick,
  allowWorkdir = false,
  testId,
  label,
}: Props) {
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const anchorRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (popoverRef.current && t && popoverRef.current.contains(t)) return;
      if (anchorRef.current && t && anchorRef.current.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();

  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = [];
    if (allowWorkdir && (!q || WORKDIR_LABEL.toLowerCase().includes(q))) {
      out.push({
        group: "Working tree",
        side: WORKDIR,
        label: WORKDIR_LABEL,
        detail: "including untracked files",
        icon: "folder",
      });
    }
    for (const b of branches) {
      if (q && !b.name.toLowerCase().includes(q)) continue;
      out.push({
        group: b.isRemote ? "Branches — remote" : "Branches — local",
        side: { kind: "rev", rev: b.name },
        label: b.name,
        detail: b.upstream ?? undefined,
        icon: "branch",
      });
    }
    for (const t of tags) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      out.push({
        group: "Tags",
        side: { kind: "rev", rev: t.name },
        label: t.name,
        detail: t.shortOid,
        icon: "tag",
      });
    }
    // Anything typed is a legal revspec — `main~3`, `origin/main@{1}`, an oid.
    // The backend answers InvalidRef if it does not resolve, which the screen
    // renders in place rather than as an app-level error.
    if (query.trim() && !out.some((r) => r.label === query.trim())) {
      out.push({
        group: "Use as revspec",
        side: { kind: "rev", rev: query.trim() },
        label: query.trim(),
        detail: "any revspec",
        icon: "commit",
      });
    }
    return out;
  }, [allowWorkdir, branches, tags, q, query]);

  const groups = React.useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      if (!byGroup.has(r.group)) {
        byGroup.set(r.group, []);
        order.push(r.group);
      }
      byGroup.get(r.group)!.push(r);
    }
    return order.map((g) => ({ group: g, rows: byGroup.get(g)! }));
  }, [rows]);

  const pick = (r: Row) => {
    onPick(r.side);
    setOpen(false);
  };

  const rect = anchorRef.current?.getBoundingClientRect();
  const popover =
    open && rect
      ? ReactDOM.createPortal(
          <div
            ref={popoverRef}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            style={{
              position: "fixed",
              left: Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)),
              top: rect.bottom + 4,
              width: WIDTH,
              maxHeight: MAX_HEIGHT,
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-3)",
              boxShadow: "var(--shadow-2)",
              zIndex: 100,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
              <PGSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Branch, tag, or revspec…"
                inputRef={inputRef}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {groups.length === 0 ? (
                <div
                  style={{
                    padding: 12,
                    color: "var(--fg-3)",
                    fontSize: "var(--fs-12)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  No matches.
                </div>
              ) : (
                groups.map(({ group, rows: groupRows }) => (
                  <div key={group}>
                    <div
                      style={{
                        padding: "6px 10px 2px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--fs-10)",
                        color: "var(--fg-2)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {group}
                    </div>
                    {groupRows.map((r) => (
                      <div
                        key={`${group}:${r.label}`}
                        data-testid="compare-side-option"
                        data-pg-row=""
                        onClick={() => pick(r)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          // Density-aware, like every other list row (#70).
                          height: "calc(26px + var(--row-step))",
                          padding: "0 10px",
                          cursor: "pointer",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-12)",
                        }}
                      >
                        <PGIcon
                          name={r.icon}
                          size={12}
                          style={{ color: "var(--fg-2)", flexShrink: 0 }}
                        />
                        <span
                          style={{
                            color: "var(--fg-0)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.label}
                        </span>
                        {r.detail && (
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              textAlign: "right",
                              color: "var(--fg-3)",
                              fontSize: "var(--fs-11)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={anchorRef}
        data-testid={testId}
        aria-label={label}
        title={`${label}: ${sideLabel(side)}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 280,
          minWidth: 0,
          padding: "2px 8px",
          height: 24,
          background: "var(--bg-2)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-2)",
          color: "var(--fg-0)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          cursor: "pointer",
        }}
      >
        <PGIcon
          name={side.kind === "workdir" ? "folder" : "branch"}
          size={11}
          style={{ color: "var(--fg-2)", flexShrink: 0 }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sideLabel(side)}
        </span>
        {side.kind === "workdir" && (
          // The semantics are stated, not left to be inferred from the result
          // (spec §C).
          <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-10)", flexShrink: 0 }}>
            + untracked
          </span>
        )}
        <PGIcon
          name="chevronDown"
          size={10}
          style={{ color: "var(--fg-3)", flexShrink: 0 }}
        />
      </button>
      {popover}
    </>
  );
}
