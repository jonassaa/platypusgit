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
  pgFlash,
  useContextMenu,
  usePaneWidth,
} from "@/design";
import { layoutGraph } from "@/features/commits/graphLayout";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, mapCommitRefs, relativeTime, shortSha } from "@/lib/derive";
import type { CommitInfo } from "@/lib/types";

type HistoryFilterKind = "all" | "mine" | "branch";
type RefFilter = "all" | "local";

export function HistoryScreen() {
  const commits = useRepoStore((s) => s.commits);
  const branches = useRepoStore((s) => s.branches);
  const loading = useRepoStore((s) => s.loading);
  const [selected, setSelected] = React.useState(0);
  const [filter, setFilter] = React.useState("");
  const [filterKind, setFilterKind] = React.useState<HistoryFilterKind>("all");
  const [refFilter, setRefFilter] = React.useState<RefFilter>("all");
  const [hideMerges, setHideMerges] = React.useState(false);
  const detailPane = usePaneWidth(440, {
    min: 280,
    max: 720,
    storageKey: "pg-history-detail-w",
  });

  // Reset selection when the commit list changes shape.
  React.useEffect(() => {
    setSelected(0);
  }, [commits.length]);

  const head = currentBranch(branches);
  const headName = head?.name ?? null;
  const aheadCount = head?.ahead ?? 0;
  const { onContextMenu: onCommitContext, menu: commitMenu } =
    useContextMenu<{ sha: string; subject: string }>(commitMenuItems);

  // Most-frequent author email in the loaded history — used as a "mine" heuristic
  // until we expose git config (user.email) to the frontend.
  const myEmail = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commits) counts.set(c.email, (counts.get(c.email) ?? 0) + 1);
    let best: string | null = null;
    let n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
  }, [commits]);

  const visible = React.useMemo(() => {
    let list: CommitInfo[] = commits;
    if (filterKind === "mine" && myEmail) {
      list = list.filter((c) => c.email === myEmail);
    } else if (filterKind === "branch" && aheadCount > 0) {
      // Approximate: "commits unique to this branch" ≈ top-N where N = ahead.
      list = list.slice(0, aheadCount);
    }
    if (hideMerges) list = list.filter((c) => c.parents.length <= 1);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (c) =>
          c.summary.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.shortOid.toLowerCase().includes(q) ||
          c.refs.some((r) => r.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [commits, filter, filterKind, myEmail, hideMerges, aheadCount]);

  const rows = React.useMemo(() => layoutGraph(visible), [visible]);

  const exportVisible = React.useCallback(() => {
    const lines = visible.map(
      (c) =>
        `${c.shortOid}  ${new Date(c.timestamp * 1000).toISOString()}  ${c.author} <${c.email}>  ${c.summary}`,
    );
    navigator.clipboard?.writeText(lines.join("\n"));
    pgFlash(`copied ${visible.length} commit${visible.length === 1 ? "" : "s"}`);
  }, [visible]);

  const toolbarRight = (
    <HistoryToolbarRight
      refFilter={refFilter}
      onRefFilter={setRefFilter}
      hideMerges={hideMerges}
      onHideMerges={setHideMerges}
      onExport={exportVisible}
    />
  );
  const toolbarLeft = (
    <HistoryToolbarLeft
      filter={filter}
      onFilter={setFilter}
      filterKind={filterKind}
      onFilterKind={setFilterKind}
    />
  );

  if (!commits.length) {
    return (
      <>
        <PGToolbar left={toolbarLeft} right={toolbarRight} />
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
      <PGToolbar left={toolbarLeft} right={toolbarRight} />
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
            {visible.length === 0 && (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "var(--fg-3)",
                  fontSize: "var(--fs-12)",
                }}
              >
                No commits match the current filters.
              </div>
            )}
            {visible.map((c, i) => {
              const g = rows[i];
              const refs = mapCommitRefs(c.refs, headName);
              const visibleRefs =
                refFilter === "local" ? refs.filter((r) => !r.remote) : refs;
              return (
                <PGCommitRow
                  key={c.oid}
                  lanes={g?.lanes}
                  node={g?.node}
                  sha={c.shortOid}
                  message={c.summary}
                  author={c.author || "unknown"}
                  date={relativeTime(c.timestamp)}
                  refs={visibleRefs}
                  selected={selected === i}
                  onClick={() => setSelected(i)}
                  onContextMenu={(e) =>
                    onCommitContext(e, { sha: c.oid, subject: c.summary })
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
          {current && (
            <>
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
              <CommitActionRow commit={current} />
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
            </>
          )}
        </div>
      </div>
      {commitMenu}
    </>
  );
}

function CommitActionRow({ commit }: { commit: CommitInfo }) {
  const store = useRepoStore;
  const branchHere = React.useCallback(() => {
    const name = window.prompt(`Create branch at ${commit.shortOid}`);
    if (!name) return;
    store.getState().createBranch(name, commit.oid);
  }, [commit, store]);
  const tagHere = React.useCallback(() => {
    const name = window.prompt(`Tag name for ${commit.shortOid}`);
    if (!name) return;
    const annotation = window.prompt("Annotation (optional, leave blank for lightweight)");
    store.getState().createTag(name, {
      oid: commit.oid,
      annotation: annotation ? annotation : null,
    });
  }, [commit, store]);
  const cherryPick = React.useCallback(() => {
    if (!window.confirm(`Cherry-pick ${commit.shortOid} onto current branch?`))
      return;
    store.getState().cherryPick(commit.oid);
  }, [commit, store]);
  const revert = React.useCallback(() => {
    if (!window.confirm(`Revert ${commit.shortOid}? A new commit will be created.`))
      return;
    store.getState().revert(commit.oid);
  }, [commit, store]);
  return (
    <div
      style={{
        padding: "0 12px 10px",
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
      }}
    >
      <PGButton size="sm" variant="outline" icon="branch" onClick={branchHere}>
        Branch here
      </PGButton>
      <PGButton size="sm" variant="outline" icon="tag" onClick={tagHere}>
        Tag
      </PGButton>
      <PGButton size="sm" variant="outline" icon="commit" onClick={cherryPick}>
        Cherry-pick
      </PGButton>
      <PGButton size="sm" variant="outline" icon="x" onClick={revert}>
        Revert
      </PGButton>
      <PGButton
        size="sm"
        variant="ghost"
        icon="copy"
        onClick={() => navigator.clipboard?.writeText(commit.oid)}
      >
        Copy SHA
      </PGButton>
    </div>
  );
}

function HistoryToolbarLeft({
  filter,
  onFilter,
  filterKind,
  onFilterKind,
}: {
  filter: string;
  onFilter: (v: string) => void;
  filterKind: HistoryFilterKind;
  onFilterKind: (v: HistoryFilterKind) => void;
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
        value={filterKind}
        onChange={(v) => onFilterKind(v as HistoryFilterKind)}
        options={[
          { value: "all", label: "All" },
          { value: "mine", label: "Mine" },
          { value: "branch", label: "This branch" },
        ]}
      />
    </>
  );
}

function HistoryToolbarRight({
  refFilter,
  onRefFilter,
  hideMerges,
  onHideMerges,
  onExport,
}: {
  refFilter: RefFilter;
  onRefFilter: (v: RefFilter) => void;
  hideMerges: boolean;
  onHideMerges: (v: boolean) => void;
  onExport: () => void;
}) {
  const { openAt, menu } = useContextMenu<null>(() => [
    { __menuTitle: "Filters" },
    {
      icon: hideMerges ? "check" : "dot",
      label: hideMerges ? "Show merge commits" : "Hide merge commits",
      onClick: () => onHideMerges(!hideMerges),
    },
  ]);
  return (
    <>
      <PGSelect
        value={refFilter}
        onChange={(v) => onRefFilter(v as RefFilter)}
        options={[
          { value: "all", label: "All refs" },
          { value: "local", label: "Local only" },
        ]}
        size="sm"
      />
      <PGIconButton
        icon="filter"
        size="md"
        title="Filter"
        onClick={(e) => openAt(e.clientX, e.clientY + 4, null)}
      />
      <PGIconButton
        icon="download"
        size="md"
        title="Export visible commits to clipboard"
        onClick={onExport}
      />
      {menu}
    </>
  );
}
