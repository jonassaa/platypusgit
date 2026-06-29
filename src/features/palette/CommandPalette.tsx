import React from "react";
import ReactDOM from "react-dom";
import { PGIcon, PGSearchInput } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "./usePaletteStore";
import { fuzzyMatch } from "./fuzzyMatch";
import { relativeTime } from "@/lib/derive";

type ResultType = "command" | "branch" | "file" | "commit";

interface PaletteItem {
  type: ResultType;
  /** Stable key for React + nav. */
  id: string;
  /** String the fuzzy matcher runs against. */
  search: string;
  /** Primary label shown to the user. */
  label: string;
  /** Optional muted secondary detail. */
  detail?: string;
  icon: string;
  run: () => void;
}

const TYPE_LABEL: Record<ResultType, string> = {
  command: "Commands",
  branch: "Branches",
  file: "Files",
  commit: "Commits",
};

const TYPE_ORDER: ResultType[] = ["command", "branch", "file", "commit"];

// Per-type caps so a huge repo can't drown out other types.
const CAP: Record<ResultType, number> = {
  command: 12,
  branch: 8,
  file: 12,
  commit: 8,
};

const WIDTH = 560;

/**
 * Static app-command / screen-switch entries. Screen switches go through the
 * `switch-screen` nav intent so the palette stays decoupled from AppShell's
 * local screen state.
 */
function buildCommands(): PaletteItem[] {
  const nav = useNavStore.getState();
  const screen = (id: string, label: string, icon: string, shortcut?: string): PaletteItem => ({
    type: "command",
    id: `screen:${id}`,
    search: `${label} ${id}`,
    label: `Go to ${label}`,
    detail: shortcut,
    icon,
    run: () => nav.setIntent({ kind: "switch-screen", screen: id }),
  });
  const repo = useRepoStore.getState();
  return [
    screen("repo", "Files", "folder", "⌘1"),
    screen("commit", "Commit", "commit", "⌘2"),
    screen("history", "History", "history", "⌘3"),
    screen("branches", "Branches", "branch", "⌘4"),
    screen("conflict", "Conflicts", "conflict", "⌘5"),
    screen("rebase", "Rebase", "rebase", "⌘6"),
    screen("remote", "Remotes", "link", "⌘7"),
    screen("diff", "Diff viewer", "fileCode", "⌘8"),
    screen("reflog", "Reflog", "clock", "⌘9"),
    screen("settings", "Settings", "settings"),
    {
      type: "command",
      id: "action:fetch-all",
      search: "Fetch all remotes",
      label: "Fetch all remotes",
      icon: "fetch",
      run: () => void repo.fetchAll(),
    },
    {
      type: "command",
      id: "action:refresh",
      search: "Refresh repository",
      label: "Refresh repository",
      icon: "sync",
      run: () => void repo.refreshAll(),
    },
  ];
}

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const closePalette = usePaletteStore((s) => s.closePalette);

  const repoOpen = useRepoStore((s) => !!s.current);
  const branches = useRepoStore((s) => s.branches);
  const allFiles = useRepoStore((s) => s.allFiles);
  const commits = useRepoStore((s) => s.commits);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const refreshAllFiles = useRepoStore((s) => s.refreshAllFiles);
  const setIntent = useNavStore((s) => s.setIntent);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Build the full candidate set (independent of query).
  const candidates = React.useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = buildCommands();

    for (const b of branches) {
      items.push({
        type: "branch",
        id: `branch:${b.isRemote ? "r" : "l"}:${b.name}`,
        search: b.name,
        label: b.name,
        detail: b.isRemote ? "remote" : (b.upstream ?? undefined),
        icon: "branch",
        run: () => void checkoutBranch(b.name),
      });
    }

    for (const f of allFiles) {
      const slash = f.path.lastIndexOf("/");
      items.push({
        type: "file",
        id: `file:${f.path}`,
        search: f.path,
        label: slash >= 0 ? f.path.slice(slash + 1) : f.path,
        detail: slash >= 0 ? f.path.slice(0, slash) : undefined,
        icon: "file",
        run: () => setIntent({ kind: "diff-file", path: f.path }),
      });
    }

    for (const c of commits) {
      items.push({
        type: "commit",
        id: `commit:${c.oid}`,
        search: `${c.summary} ${c.shortOid} ${c.author}`,
        label: c.summary,
        detail: `${c.shortOid} · ${relativeTime(c.timestamp)}`,
        icon: "commit",
        run: () => setIntent({ kind: "commit-vs-wt", oid: c.oid }),
      });
    }

    return items;
  }, [branches, allFiles, commits, checkoutBranch, setIntent]);

  // Filter + score + group + cap, then flatten for keyboard nav.
  const { flat, groups } = React.useMemo(() => {
    const byType: Record<ResultType, { item: PaletteItem; score: number; indices: number[] }[]> = {
      command: [],
      branch: [],
      file: [],
      commit: [],
    };
    for (const item of candidates) {
      const m = fuzzyMatch(query, item.search);
      if (!m.matched) continue;
      byType[item.type].push({ item, score: m.score, indices: m.indices });
    }
    const groupsOut: { type: ResultType; rows: PaletteItem[] }[] = [];
    const flatOut: PaletteItem[] = [];
    for (const type of TYPE_ORDER) {
      const sorted = byType[type]
        .sort((a, b) => b.score - a.score)
        .slice(0, CAP[type])
        .map((r) => r.item);
      if (sorted.length === 0) continue;
      groupsOut.push({ type, rows: sorted });
      flatOut.push(...sorted);
    }
    return { flat: flatOut, groups: groupsOut };
  }, [candidates, query]);

  // When opened: focus input, refresh the lazy file list, reset state.
  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    if (repoOpen) void refreshAllFiles();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, repoOpen, refreshAllFiles]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  // Keep the active row scrolled into view.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-pal-index="${activeIndex}"]`,
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const activate = (item: PaletteItem | undefined) => {
    if (!item) return;
    closePalette();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
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
      activate(flat[activeIndex]);
      return;
    }
  };

  const sectionHeader = (label: string, count: number) => (
    <div
      style={{
        padding: "8px 12px 2px",
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

  const renderRow = (item: PaletteItem, flatIndex: number) => {
    const active = flatIndex === activeIndex;
    return (
      <div
        key={item.id}
        data-pal-index={flatIndex}
        data-pal-type={item.type}
        onClick={() => activate(item)}
        onMouseEnter={() => setActiveIndex(flatIndex)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 30,
          padding: "0 12px",
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
        }}
      >
        <PGIcon name={item.icon} size={13} style={{ color: "var(--fg-2)" }} />
        <span
          title={item.label}
          style={{
            flexShrink: 0,
            maxWidth: 360,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fg-0)",
          }}
        >
          {item.label}
        </span>
        {item.detail && (
          <span
            title={item.detail}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "right",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fg-3)",
              fontSize: "var(--fs-10)",
            }}
          >
            {item.detail}
          </span>
        )}
      </div>
    );
  };

  let runningIndex = 0;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        // Backdrop click (outside the panel) closes.
        if (e.target === e.currentTarget) closePalette();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div
        onKeyDown={onKeyDown}
        style={{
          width: WIDTH,
          maxWidth: "90vw",
          maxHeight: "60vh",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-3)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search branches, files, commits, commands…"
            inputRef={inputRef}
          />
        </div>
        <div ref={listRef} style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
          {flat.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: "var(--fs-12)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {query ? `No matches for "${query}".` : "Type to search."}
            </div>
          ) : (
            groups.map((g) => {
              const rows = (
                <React.Fragment key={g.type}>
                  {sectionHeader(TYPE_LABEL[g.type], g.rows.length)}
                  {g.rows.map((item) => renderRow(item, runningIndex++))}
                </React.Fragment>
              );
              return rows;
            })
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
