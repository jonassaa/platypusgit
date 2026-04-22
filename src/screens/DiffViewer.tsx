import React from "react";
import {
  PGBadge,
  PGButtonGroup,
  PGEmpty,
  PGHunk,
  PGIconButton,
  PGSearchInput,
  PGSideBySideDiff,
  PGSpinner,
  PGStatusMark,
  PGToggle,
  PGToolbar,
  type DiffLineData,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { statusMark } from "@/lib/derive";
import { getDiff } from "@/lib/tauri";
import type { FileDiff } from "@/lib/types";

export function DiffViewerScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const [mode, setMode] = React.useState<"unified" | "split">("unified");
  const [wrap, setWrap] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);

  const filtered = React.useMemo(
    () =>
      status.filter(
        (s) =>
          s.path.toLowerCase().includes(filter.toLowerCase()) &&
          (s.worktree.kind !== "Unmodified" || s.index.kind !== "Unmodified"),
      ),
    [status, filter],
  );

  React.useEffect(() => {
    if (!selectedPath && filtered[0]) setSelectedPath(filtered[0].path);
  }, [filtered, selectedPath]);

  const current = status.find((s) => s.path === selectedPath) ?? null;

  React.useEffect(() => {
    if (!current || !repo) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    getDiff(repo.id, current.path, "WorktreeToHead")
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.path, repo]);

  const split = React.useMemo(() => diffToSplit(diff), [diff]);

  if (status.length === 0) {
    return (
      <PGEmpty icon="fileCode" title="Nothing to diff">
        Working tree is clean. Make a change and revisit.
      </PGEmpty>
    );
  }

  return (
    <>
      <PGToolbar
        left={
          <>
            <PGSearchInput
              value={filter}
              onChange={setFilter}
              placeholder="Filter files…"
              style={{ width: 280 }}
            />
            {current && (
              <>
                <div
                  style={{
                    width: 1,
                    height: 16,
                    background: "var(--border-1)",
                    margin: "0 4px",
                  }}
                />
                <PGStatusMark kind={statusMark(current)} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-13)",
                  }}
                >
                  {current.path}
                </span>
                {diff && !diff.binary && (
                  <>
                    <PGBadge tone="success">+{diff.additions}</PGBadge>
                    <PGBadge tone="danger">−{diff.deletions}</PGBadge>
                  </>
                )}
              </>
            )}
          </>
        }
        right={
          <>
            <PGButtonGroup
              value={mode}
              onChange={(v) => setMode(v as typeof mode)}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
            />
            <PGToggle checked={wrap} onChange={setWrap} label="Wrap" />
            <PGIconButton icon="search" size="md" title="Find in diff" />
          </>
        }
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          background: "var(--bg-0)",
        }}
      >
        <div
          style={{
            width: 280,
            borderRight: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            overflow: "auto",
          }}
        >
          {filtered.map((f) => (
            <div
              key={f.path}
              onClick={() => setSelectedPath(f.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                height: 24,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                cursor: "pointer",
                background:
                  selectedPath === f.path
                    ? "var(--bg-selection)"
                    : "transparent",
                color: "var(--fg-0)",
                borderLeft:
                  selectedPath === f.path
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
              }}
            >
              <PGStatusMark kind={statusMark(f)} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.path}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {diffLoading && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--fg-2)",
              }}
            >
              <PGSpinner size={14} />
            </div>
          )}
          {!diffLoading && diff?.binary && (
            <PGEmpty icon="file" title="Binary file" />
          )}
          {!diffLoading && diff && !diff.binary && mode === "unified" && (
            <div style={{ flex: 1, overflow: "auto" }}>
              {diff.hunks.map((h, i) => (
                <PGHunk
                  key={i}
                  header={h.header.replace(/^@@\s*|\s*@@$/g, "").trim()}
                  lines={h.lines.map(toUiLine)}
                  expanded={true}
                />
              ))}
            </div>
          )}
          {!diffLoading && diff && !diff.binary && mode === "split" && (
            <PGSideBySideDiff left={split.left} right={split.right} />
          )}
        </div>
      </div>
    </>
  );
}

function toUiLine(l: {
  kind: { kind: string };
  oldLineno: number | null;
  newLineno: number | null;
  content: string;
}): DiffLineData {
  const k = l.kind.kind;
  if (k === "Addition")
    return { kind: "add", lnR: l.newLineno ?? undefined, text: l.content };
  if (k === "Deletion")
    return { kind: "rem", lnL: l.oldLineno ?? undefined, text: l.content };
  return {
    kind: "ctx",
    lnL: l.oldLineno ?? undefined,
    lnR: l.newLineno ?? undefined,
    text: l.content,
  };
}

function diffToSplit(d: FileDiff | null): {
  left: SideLine[];
  right: SideLine[];
} {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
  if (!d) return { left, right };
  for (const h of d.hunks) {
    left.push({ kind: "info", text: h.header });
    right.push({ kind: "info", text: h.header });
    for (const ln of h.lines) {
      const k = ln.kind.kind;
      if (k === "Addition") {
        left.push({ kind: "empty", ln: "", text: "" });
        right.push({
          kind: "add",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      } else if (k === "Deletion") {
        left.push({
          kind: "rem",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({ kind: "empty", ln: "", text: "" });
      } else {
        left.push({
          kind: "ctx",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({
          kind: "ctx",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      }
    }
  }
  return { left, right };
}
