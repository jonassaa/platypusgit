import React from "react";
import {
  PGBadge,
  PGButton,
  PGButtonGroup,
  PGCommitDetail,
  PGCommitRow,
  PGEmpty,
  PGIconButton,
  PGResizeHandle,
  PGSearchInput,
  PGSelect,
  PGSpinner,
  PGToolbar,
  commitMenuItems,
  useContextMenu,
  usePaneWidth,
  type GraphLane,
  type GraphNode,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, mapCommitRefs, relativeTime, shortSha } from "@/lib/derive";
import type { CommitInfo } from "@/lib/types";

export function HistoryScreen() {
  const commits = useRepoStore((s) => s.commits);
  const branches = useRepoStore((s) => s.branches);
  const loading = useRepoStore((s) => s.loading);
  const [selected, setSelected] = React.useState(0);
  const [filter, setFilter] = React.useState("");
  const detailPane = usePaneWidth(440, {
    min: 280,
    max: 720,
    storageKey: "pg-history-detail-w",
  });

  // Reset selection when the commit list changes shape.
  React.useEffect(() => {
    setSelected(0);
  }, [commits.length]);

  const headName = currentBranch(branches)?.name ?? null;
  const { onContextMenu: onCommitContext, menu: commitMenu } =
    useContextMenu<{ sha: string; subject: string }>(commitMenuItems);

  const visible = React.useMemo(() => {
    if (!filter.trim()) return commits;
    const q = filter.toLowerCase();
    return commits.filter(
      (c) =>
        c.summary.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.shortOid.toLowerCase().includes(q) ||
        c.refs.some((r) => r.toLowerCase().includes(q)),
    );
  }, [commits, filter]);

  /**
   * Very simple graph renderer: everything on col 0, merge commits get a
   * small diagonal hint. A real multi-lane layout is a follow-up.
   */
  const buildLanes = (
    c: CommitInfo,
    i: number,
    arr: CommitInfo[],
  ): { lanes: GraphLane[]; node: GraphNode } => {
    const lanes: GraphLane[] = [];
    lanes.push({
      col: 0,
      color: "var(--graph-1)",
      kind:
        i === 0
          ? "half-bot"
          : i === arr.length - 1
            ? "half-top"
            : "line",
    });
    if (c.parents.length > 1) {
      lanes.push({ col: 1, to: 0, color: "var(--graph-2)", kind: "diag" });
    }
    return {
      lanes,
      node: {
        col: 0,
        color: "var(--graph-1)",
        solid: c.parents.length <= 1,
        merge: c.parents.length > 1,
      },
    };
  };

  if (!commits.length) {
    return (
      <>
        <PGToolbar
          left={<HistoryToolbarLeft filter={filter} onFilter={setFilter} />}
          right={<HistoryToolbarRight />}
        />
        {loading ? (
          <PGEmpty icon="history" title={<PGSpinner size={18} />}>
            Loading commits…
          </PGEmpty>
        ) : (
          <PGEmpty icon="history" title="No commits yet">
            This repository doesn&apos;t have any commits on HEAD.
          </PGEmpty>
        )}
      </>
    );
  }

  const current = visible[selected] ?? visible[0];

  return (
    <>
      <PGToolbar
        left={<HistoryToolbarLeft filter={filter} onFilter={setFilter} />}
        right={<HistoryToolbarRight />}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 70px 1fr 150px 90px",
              height: 24,
              background: "var(--bg-2)",
              borderBottom: "1px solid var(--border-0)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-10)",
              color: "var(--fg-2)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              alignItems: "center",
            }}
          >
            <span style={{ paddingLeft: 12 }}>GRAPH</span>
            <span>SHA</span>
            <span>SUBJECT</span>
            <span>AUTHOR</span>
            <span>DATE</span>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {visible.map((c, i) => {
              const g = buildLanes(c, i, visible);
              return (
                <PGCommitRow
                  key={c.oid}
                  lanes={g.lanes}
                  node={g.node}
                  sha={c.shortOid}
                  message={c.summary}
                  author={c.author || "unknown"}
                  date={relativeTime(c.timestamp)}
                  refs={mapCommitRefs(c.refs, headName)}
                  selected={selected === i}
                  onClick={() => setSelected(i)}
                  onContextMenu={(e) =>
                    onCommitContext(e, { sha: c.shortOid, subject: c.summary })
                  }
                />
              );
            })}
          </div>
        </div>

        <PGResizeHandle onDrag={(d) => detailPane.resize(-d)} side="left" />
        <div
          style={{
            width: detailPane.width,
            flexShrink: 0,
            borderLeft: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <PGCommitDetail
            sha={current.shortOid}
            fullSha={current.oid}
            subject={current.summary}
            body={current.body ?? undefined}
            author={current.author || "unknown"}
            email={current.email}
            date={relativeTime(current.timestamp)}
            parents={current.parents.map(shortSha)}
          />
          <div
            style={{
              padding: "0 12px 10px",
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <PGButton size="sm" variant="outline" icon="branch" disabled>
              Branch here
            </PGButton>
            <PGButton size="sm" variant="outline" icon="tag" disabled>
              Tag
            </PGButton>
            <PGButton size="sm" variant="outline" icon="commit" disabled>
              Cherry-pick
            </PGButton>
            <PGButton size="sm" variant="outline" icon="x" disabled>
              Revert
            </PGButton>
            <PGButton
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={() => navigator.clipboard?.writeText(current.oid)}
            >
              Copy SHA
            </PGButton>
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border-0)",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                height: 26,
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-1)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "var(--bg-2)",
                borderBottom: "1px solid var(--border-0)",
                justifyContent: "space-between",
              }}
            >
              <span>PARENTS</span>
              <PGBadge tone="muted">{current.parents.length}</PGBadge>
            </div>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "8px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--fg-2)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {current.parents.length === 0 && (
                <span style={{ color: "var(--fg-3)" }}>(initial commit)</span>
              )}
              {current.parents.map((p) => (
                <span key={p}>
                  <span style={{ color: "var(--accent)" }}>{shortSha(p)}</span>{" "}
                  <span style={{ color: "var(--fg-3)" }}>{p}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {commitMenu}
    </>
  );
}

function HistoryToolbarLeft({
  filter,
  onFilter,
}: {
  filter: string;
  onFilter: (v: string) => void;
}) {
  return (
    <>
      <PGSearchInput
        value={filter}
        onChange={onFilter}
        placeholder="Search commits, authors, refs…"
        shortcut="⌘F"
        style={{ width: 340 }}
      />
      <PGButtonGroup
        value="all"
        onChange={() => {}}
        options={[
          { value: "all", label: "All" },
          { value: "mine", label: "Mine" },
          { value: "branch", label: "This branch" },
        ]}
      />
    </>
  );
}

function HistoryToolbarRight() {
  return (
    <>
      <PGSelect
        value="all"
        options={[
          { value: "all", label: "All refs" },
          { value: "local", label: "Local only" },
        ]}
        size="sm"
      />
      <PGIconButton icon="filter" size="md" title="Filter" />
      <PGIconButton icon="download" size="md" title="Export" />
    </>
  );
}
