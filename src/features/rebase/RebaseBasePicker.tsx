import React from "react";
import ReactDOM from "react-dom";
import { PGIcon, PGSearchInput } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo, CommitInfo } from "@/lib/types";

type RowKind = "branchLocal" | "branchRemote" | "commit" | "freeform";

interface Row {
  kind: RowKind;
  oid: string;
  label: string;
  /** Sub-text shown to right (subject for commits, upstream/ahead-behind for branches). */
  detail?: string;
  /** Branch source for picking. */
  branch?: BranchInfo;
  /** Commit source for picking. */
  commit?: CommitInfo;
}

interface Props {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onPick: (oid: string, label: string) => void;
  /** Optional notice shown above the search input (e.g. error). */
  notice?: string | null;
  /** OIDs that are not on the current branch's history — used to mark rows as ineligible. */
  invalidOids?: Set<string>;
}

const WIDTH = 460;
const MAX_HEIGHT = 520;
const MAX_COMMITS = 200;
const HEX_RE = /^[0-9a-f]{4,40}$/i;

export function RebaseBasePicker({
  anchor,
  open,
  onClose,
  onPick,
  notice,
  invalidOids,
}: Props) {
  const branches = useRepoStore((s) => s.branches);
  const commits = useRepoStore((s) => s.commits);

  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      const popover = popoverRef.current;
      if (popover && t && popover.contains(t)) return;
      if (anchor && t && anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, onClose, anchor]);

  const q = query.trim().toLowerCase();

  const branchRows: Row[] = React.useMemo(() => {
    const matches = branches.filter((b) => b.tip && b.name.toLowerCase().includes(q));
    return matches.map((b) => {
      const detailParts: string[] = [];
      if (b.upstream) detailParts.push(b.upstream);
      if (b.ahead) detailParts.push(`↑${b.ahead}`);
      if (b.behind) detailParts.push(`↓${b.behind}`);
      return {
        kind: b.isRemote ? "branchRemote" : "branchLocal",
        oid: b.tip!,
        label: b.name,
        detail: detailParts.join(" · "),
        branch: b,
      };
    });
  }, [branches, q]);

  const commitRows: Row[] = React.useMemo(() => {
    const limited = commits.slice(0, MAX_COMMITS);
    const matches = q
      ? limited.filter(
          (c) =>
            c.summary.toLowerCase().includes(q) ||
            c.oid.toLowerCase().startsWith(q) ||
            c.author.toLowerCase().includes(q),
        )
      : limited;
    return matches.map((c) => ({
      kind: "commit",
      oid: c.oid,
      label: c.shortOid,
      detail: c.summary,
      commit: c,
    }));
  }, [commits, q]);

  /** Free-form hash row: only when query looks hex and isn't already a known commit-oid prefix. */
  const freeformRow: Row | null = React.useMemo(() => {
    if (!q || !HEX_RE.test(q)) return null;
    const knownExact = commits.some((c) => c.oid.toLowerCase() === q || c.shortOid.toLowerCase() === q);
    if (knownExact) return null;
    return {
      kind: "freeform",
      oid: q,
      label: q,
      detail: "use as commit hash",
    };
  }, [q, commits]);

  const local = branchRows.filter((r) => r.kind === "branchLocal");
  const remote = branchRows.filter((r) => r.kind === "branchRemote");
  const flat: Row[] = React.useMemo(
    () => [...local, ...remote, ...commitRows, ...(freeformRow ? [freeformRow] : [])],
    [local, remote, commitRows, freeformRow],
  );

  React.useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  const pick = (r: Row) => {
    onPick(r.oid, r.kind === "commit" ? `${r.label} — ${r.detail ?? ""}`.trim() : r.label);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = flat[activeIndex];
      if (row) pick(row);
      return;
    }
  };

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
  const top = rect.bottom + 4;

  const renderRow = (r: Row, idx: number) => {
    const active = idx === activeIndex;
    const ineligible = invalidOids?.has(r.oid) ?? false;
    const iconName =
      r.kind === "branchLocal" || r.kind === "branchRemote" ? "branch" : "commit";
    return (
      <div
        key={`${r.kind}:${r.oid}:${r.label}`}
        onClick={() => pick(r)}
        onMouseEnter={() => setActiveIndex(idx)}
        title={ineligible ? "Not on current branch's history" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 26,
          padding: "0 10px",
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          opacity: ineligible ? 0.5 : 1,
        }}
      >
        <PGIcon
          name={iconName}
          size={12}
          style={{ color: "var(--fg-2)", flexShrink: 0 }}
        />
        <span
          style={{
            flexShrink: 0,
            color: "var(--fg-0)",
            maxWidth: 180,
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
    );
  };

  const sectionHeader = (label: string, count: number) => (
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
      {label} <span style={{ color: "var(--fg-3)" }}>({count})</span>
    </div>
  );

  let runningIdx = 0;
  const localStart = runningIdx;
  runningIdx += local.length;
  const remoteStart = runningIdx;
  runningIdx += remote.length;
  const commitStart = runningIdx;
  runningIdx += commitRows.length;
  const freeformStart = runningIdx;

  const content = (
    <div
      ref={popoverRef}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        left,
        top,
        width: WIDTH,
        maxHeight: MAX_HEIGHT,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {notice && (
        <div
          style={{
            padding: "6px 10px",
            background: "oklch(from var(--git-conflict) l c h / 0.12)",
            borderBottom: "1px solid var(--git-conflict)",
            color: "var(--fg-0)",
            fontSize: "var(--fs-12)",
          }}
        >
          {notice}
        </div>
      )}
      <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
        <PGSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Branch, commit subject, or hash…"
          inputRef={inputRef}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {flat.length === 0 ? (
          <div
            style={{
              padding: 12,
              fontSize: "var(--fs-12)",
              color: "var(--fg-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            No matches.
          </div>
        ) : (
          <>
            {local.length > 0 && (
              <>
                {sectionHeader("Branches — local", local.length)}
                {local.map((r, i) => renderRow(r, localStart + i))}
              </>
            )}
            {remote.length > 0 && (
              <>
                {sectionHeader("Branches — remote", remote.length)}
                {remote.map((r, i) => renderRow(r, remoteStart + i))}
              </>
            )}
            {commitRows.length > 0 && (
              <>
                {sectionHeader("Recent commits", commitRows.length)}
                {commitRows.map((r, i) => renderRow(r, commitStart + i))}
              </>
            )}
            {freeformRow && (
              <>
                {sectionHeader("Use hash", 1)}
                {renderRow(freeformRow, freeformStart)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
