import React from "react";
import ReactDOM from "react-dom";
import {
  PGIcon,
  PGSearchInput,
  PGIconButton,
  useContextMenu,
  branchMenuItems,
  remoteBranchMenuItems,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo } from "@/lib/types";

interface BranchPickerProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

type Row = BranchInfo & { kind: "local" | "remote" };

const WIDTH = 400;
const MAX_HEIGHT = 480;

export function BranchPicker({ anchor, open, onClose }: BranchPickerProps) {
  const branches = useRepoStore((s) => s.branches);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const createAndSwitchBranch = useRepoStore((s) => s.createAndSwitchBranch);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const { onContextMenu: onLocalCtx, openAt: openLocal, menu: localMenu } =
    useContextMenu<BranchInfo>((b) =>
      branchMenuItems({
        name: b?.name,
        current: b?.isHead,
        upstream: b?.upstream,
      }),
    );
  const { onContextMenu: onRemoteCtx, openAt: openRemote, menu: remoteMenu } =
    useContextMenu<BranchInfo>((b) =>
      remoteBranchMenuItems({ name: b?.name }),
    );

  const local: Row[] = React.useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote && b.name.includes(query))
        .map((b) => ({ ...b, kind: "local" as const })),
    [branches, query],
  );
  const remote: Row[] = React.useMemo(
    () =>
      branches
        .filter((b) => b.isRemote && b.name.includes(query))
        .map((b) => ({ ...b, kind: "remote" as const })),
    [branches, query],
  );

  const flat = React.useMemo(() => [...local, ...remote], [local, remote]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

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

  const requestCreate = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    onClose();
    void createAndSwitchBranch(name, { autoStash: true });
  };

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - WIDTH - 8),
  );
  const top = rect.bottom + 4;

  const checkout = (r: Row) => {
    if (r.kind === "local" && r.isHead) return;
    void checkoutBranch(r.name);
    onClose();
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
      if (flat.length === 0) {
        requestCreate(query.trim() || "main");
        return;
      }
      const row = flat[activeIndex];
      if (row) checkout(row);
      return;
    }
    if (e.key === "ArrowRight") {
      const row = flat[activeIndex];
      if (!row) return;
      e.preventDefault();
      const rowEls = popoverRef.current?.querySelectorAll<HTMLElement>("[data-branch-row]");
      const rowEl = rowEls?.[activeIndex];
      const r = rowEl?.getBoundingClientRect() ?? anchor.getBoundingClientRect();
      const x = r.right - 24;
      const y = r.bottom;
      if (row.kind === "local") openLocal(x, y, row);
      else openRemote(x, y, row);
      return;
    }
  };

  const renderRow = (r: Row, idx: number) => {
    const active = idx === activeIndex;
    const handler = r.kind === "local" ? onLocalCtx : onRemoteCtx;
    return (
      <div
        key={`${r.kind}:${r.name}`}
        data-branch-row
        onClick={() => checkout(r)}
        onContextMenu={(e) => handler(e, r)}
        onMouseEnter={() => setActiveIndex(idx)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: r.kind === "local" && r.isHead ? "default" : "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
        }}
      >
        <PGIcon
          name="branch"
          size={12}
          style={{ color: r.isHead ? "var(--accent)" : "var(--fg-2)" }}
        />
        <span
          title={r.name}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: r.isHead ? "var(--accent)" : "var(--fg-0)",
          }}
        >
          {r.name}
        </span>
        {r.isHead && (
          <span
            style={{
              fontSize: "var(--fs-10)",
              color: "var(--accent)",
              padding: "0 4px",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-2)",
            }}
          >
            HEAD
          </span>
        )}
        {r.kind === "local" && r.upstream && !r.isHead && (
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: "var(--fs-10)",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.upstream}
          </span>
        )}
        {r.ahead > 0 && (
          <span style={{ color: "var(--git-added)", fontSize: "var(--fs-10)" }}>
            ↑{r.ahead}
          </span>
        )}
        {r.behind > 0 && (
          <span
            style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
          >
            ↓{r.behind}
          </span>
        )}
        <PGIconButton
          icon="more"
          size="sm"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation();
            handler(e, r);
          }}
        />
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

  const content = (
    <>
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
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Switch to branch…"
            inputRef={inputRef}
          />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {local.length === 0 && remote.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: "var(--fs-12)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {query
                ? `No branches match "${query}".`
                : "No branches in this repo."}
              <div style={{ marginTop: 8 }}>
                <span
                  data-testid="branch-create"
                  onClick={() => requestCreate(query.trim() || "main")}
                  style={{
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {query.trim()
                    ? `Create branch "${query.trim()}" from HEAD`
                    : `Create branch "main" from HEAD`}
                </span>
              </div>
            </div>
          ) : (
            <>
              {local.length > 0 && (
                <>
                  {sectionHeader("Local", local.length)}
                  {local.map((r, i) => renderRow(r, i))}
                </>
              )}
              {remote.length > 0 && (
                <>
                  {sectionHeader("Remote", remote.length)}
                  {remote.map((r, i) => renderRow(r, local.length + i))}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {localMenu}
      {remoteMenu}
    </>
  );

  return ReactDOM.createPortal(content, document.body);
}
