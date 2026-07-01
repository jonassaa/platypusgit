import React from "react";
import {
  PGBadge,
  PGButton,
  PGButtonGroup,
  PGCommitDetail,
  PGCommitRow,
  PGEmpty,
  PGIconButton,
  PGInput,
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
import { buildLogFilter, isFilterEmpty } from "@/features/commits/logFilter";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { PGPane, FocusableScroll } from "@/features/keymap";
import { currentBranch, mapCommitRefs, relativeTime, shortSha } from "@/lib/derive";
import type { CommitInfo } from "@/lib/types";

type HistoryFilterKind = "all" | "mine" | "branch";
type RefFilter = "all" | "local";

const SEARCH_DEBOUNCE_MS = 250;

export function HistoryScreen() {
  const commits = useRepoStore((s) => s.commits);
  const searchResults = useRepoStore((s) => s.searchResults);
  const searching = useRepoStore((s) => s.searching);
  const searchCommits = useRepoStore((s) => s.searchCommits);
  const branches = useRepoStore((s) => s.branches);
  const loading = useRepoStore((s) => s.loading);
  const [selected, setSelected] = React.useState(0);
  // Free-text search box (supports key:value qualifiers — see logFilter.ts).
  const [filter, setFilter] = React.useState("");
  // Dedicated structured search fields.
  const [authorQ, setAuthorQ] = React.useState("");
  const [pathQ, setPathQ] = React.useState("");
  const [sinceDate, setSinceDate] = React.useState("");
  const [untilDate, setUntilDate] = React.useState("");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [filterKind, setFilterKind] = React.useState<HistoryFilterKind>("all");
  const [refFilter, setRefFilter] = React.useState<RefFilter>("all");
  const [hideMerges, setHideMerges] = React.useState(false);

  // Debounce the backend search across all search inputs.
  const logFilter = React.useMemo(
    () =>
      buildLogFilter({
        text: filter,
        author: authorQ,
        path: pathQ,
        sinceDate,
        untilDate,
      }),
    [filter, authorQ, pathQ, sinceDate, untilDate],
  );
  const filterKey = JSON.stringify(logFilter);
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      void searchCommits(logFilter);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // filterKey captures the filter's content; logFilter identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, searchCommits]);

  const searchActive = !isFilterEmpty(logFilter);
  // Base list: backend-filtered results when a search is active, else full log.
  const baseCommits = searchActive ? (searchResults ?? []) : commits;
  const detailPane = usePaneWidth(440, {
    min: 280,
    max: 720,
    storageKey: "pg-history-detail-w",
  });

  // Reset selection when the commit list changes shape.
  React.useEffect(() => {
    setSelected(0);
  }, [baseCommits.length, filterKey]);

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

  // Text/author/path/date/sha filtering happens on the backend (baseCommits).
  // The "mine"/"branch"/hide-merges toggles remain client-side refinements.
  const visible = React.useMemo(() => {
    let list: CommitInfo[] = baseCommits;
    if (filterKind === "mine" && myEmail) {
      list = list.filter((c) => c.email === myEmail);
    } else if (filterKind === "branch" && aheadCount > 0) {
      // Approximate: "commits unique to this branch" ≈ top-N where N = ahead.
      list = list.slice(0, aheadCount);
    }
    if (hideMerges) list = list.filter((c) => c.parents.length <= 1);
    return list;
  }, [baseCommits, filterKind, myEmail, hideMerges, aheadCount]);

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
  const clearSearch = React.useCallback(() => {
    setFilter("");
    setAuthorQ("");
    setPathQ("");
    setSinceDate("");
    setUntilDate("");
  }, []);

  const toolbarLeft = (
    <HistoryToolbarLeft
      filter={filter}
      onFilter={setFilter}
      filterKind={filterKind}
      onFilterKind={setFilterKind}
      authorQ={authorQ}
      onAuthorQ={setAuthorQ}
      pathQ={pathQ}
      onPathQ={setPathQ}
      sinceDate={sinceDate}
      onSinceDate={setSinceDate}
      untilDate={untilDate}
      onUntilDate={setUntilDate}
      advancedOpen={advancedOpen}
      onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
      searchActive={searchActive}
      searching={searching}
      matchCount={searchActive ? visible.length : null}
      onClear={clearSearch}
    />
  );
  const advancedPanel = advancedOpen ? (
    <AdvancedSearchPanel
      authorQ={authorQ}
      onAuthorQ={setAuthorQ}
      pathQ={pathQ}
      onPathQ={setPathQ}
      sinceDate={sinceDate}
      onSinceDate={setSinceDate}
      untilDate={untilDate}
      onUntilDate={setUntilDate}
    />
  ) : null;

  if (!commits.length) {
    return (
      <>
        <PGToolbar left={toolbarLeft} right={toolbarRight} />
        {advancedPanel}
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
      {advancedPanel}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PGPane
          id="history.list"
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
          <FocusableScroll style={{ flex: 1 }} ariaLabel="Commit list">
            {visible.length === 0 && (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "var(--fg-3)",
                  fontSize: "var(--fs-12)",
                }}
              >
                {searching
                  ? "Searching…"
                  : searchActive
                    ? "No commits match the search."
                    : "No commits match the current filters."}
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
          </FocusableScroll>
        </PGPane>

        <PGResizeHandle onDrag={(d) => detailPane.resize(-d)} side="left" />
        <PGPane
          id="history.detail"
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
                <FocusableScroll
                  ariaLabel="Commit parents"
                  style={{
                    flex: 1,
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
                </FocusableScroll>
              </div>
            </>
          )}
        </PGPane>
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

interface HistoryToolbarLeftProps {
  filter: string;
  onFilter: (v: string) => void;
  filterKind: HistoryFilterKind;
  onFilterKind: (v: HistoryFilterKind) => void;
  authorQ: string;
  onAuthorQ: (v: string) => void;
  pathQ: string;
  onPathQ: (v: string) => void;
  sinceDate: string;
  onSinceDate: (v: string) => void;
  untilDate: string;
  onUntilDate: (v: string) => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  searchActive: boolean;
  searching: boolean;
  matchCount: number | null;
  onClear: () => void;
}

function HistoryToolbarLeft(props: HistoryToolbarLeftProps) {
  const {
    filter,
    onFilter,
    filterKind,
    onFilterKind,
    advancedOpen,
    onToggleAdvanced,
    searchActive,
    searching,
    matchCount,
    onClear,
  } = props;
  return (
    <>
      <PGSearchInput
        value={filter}
        onChange={onFilter}
        placeholder="Search message, author, sha, path… (e.g. author:bob)"
        shortcut="⌘F"
        style={{ width: 340 }}
      />
      <PGIconButton
        icon="sort"
        size="md"
        title="Advanced search (author / path / date range)"
        aria-pressed={advancedOpen}
        onClick={onToggleAdvanced}
        style={advancedOpen ? { color: "var(--accent)" } : undefined}
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
      {searchActive && (
        <>
          <span
            style={{
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {searching
              ? "searching…"
              : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
          </span>
          <PGButton size="sm" variant="ghost" icon="x" onClick={onClear}>
            Clear
          </PGButton>
        </>
      )}
    </>
  );
}

/** Field labels reused by the advanced search strip. */
function SearchField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontSize: "var(--fs-10)",
        color: "var(--fg-2)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function AdvancedSearchPanel(props: {
  authorQ: string;
  onAuthorQ: (v: string) => void;
  pathQ: string;
  onPathQ: (v: string) => void;
  sinceDate: string;
  onSinceDate: (v: string) => void;
  untilDate: string;
  onUntilDate: (v: string) => void;
}) {
  const {
    authorQ,
    onAuthorQ,
    pathQ,
    onPathQ,
    sinceDate,
    onSinceDate,
    untilDate,
    onUntilDate,
  } = props;
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-end",
        flexWrap: "wrap",
        padding: "8px 12px",
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border-0)",
        flexShrink: 0,
      }}
    >
      <SearchField label="Author">
        <PGInput
          value={authorQ}
          onChange={onAuthorQ}
          placeholder="name or email"
          icon="user"
          size="sm"
          style={{ width: 200 }}
        />
      </SearchField>
      <SearchField label="Path">
        <PGInput
          value={pathQ}
          onChange={onPathQ}
          placeholder="src/foo.ts"
          icon="file"
          size="sm"
          mono
          style={{ width: 220 }}
        />
      </SearchField>
      <SearchField label="Since">
        <PGInput
          type="date"
          value={sinceDate}
          onChange={onSinceDate}
          size="sm"
          style={{ width: 150 }}
        />
      </SearchField>
      <SearchField label="Until">
        <PGInput
          type="date"
          value={untilDate}
          onChange={onUntilDate}
          size="sm"
          style={{ width: 150 }}
        />
      </SearchField>
    </div>
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
