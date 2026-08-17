import React from "react";
import {
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
  PGSkeleton,
  PGToolbar,
  commitMenuItems,
  commitMultiMenuItems,
  COMMIT_ROW_BASE_H,
  commitRowGrid,
  graphWidth,
  isGraphClamped,
  maxVisibleCol,
  pgConfirm,
  pgFlash,
  pgPrompt,
  useContextMenu,
  usePaneWidth,
  type CommitRef,
} from "@/design";
import { layoutGraph } from "@/features/commits/graphLayout";
import { createRowCache } from "@/features/commits/rowIdentity";
import { useWindowedList } from "@/lib/useWindowedList";
import { buildLogFilter, isFilterEmpty } from "@/features/commits/logFilter";
import { planCommitSelection } from "@/features/commits/planCommitSelection";
import { headAncestryOf } from "@/features/commits/headAncestry";
import { buildRebasePlan } from "@/features/commits/buildRebasePlan";
import { combinedSquashMessage } from "@/features/commits/squashMessage";
import { runRebasePlanNow } from "@/features/commits/runRebasePlan";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { openCreateTag } from "@/features/tags/useCreateTagStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useDensityStep, useSettingsStore } from "@/features/settings/useSettingsStore";
import { resolveHeadDecor } from "@/features/settings/headMarks";
import { CommitDiffPanel } from "@/features/diff/CommitDiffPanel";
import { useIgnoreWhitespace } from "@/features/diff/WhitespaceToggle";
import { PGPane, FocusableScroll, usePaneList } from "@/features/keymap";
import {
  resolveGraphDrop,
  useDragSource,
  useDropZone,
  type DragPayload,
  type DropResolution,
  type GraphDropTarget,
} from "@/features/dnd";
import { diffCommit } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { currentBranch, mapCommitRefs, relativeTime, shortSha } from "@/lib/derive";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  type Selection,
} from "@/lib/selection";
import type { CommitInfo, FileDiff } from "@/lib/types";
import { LOG_REF_ALL } from "@/lib/types";

type HistoryFilterKind = "all" | "branch";
type RefFilter = "all" | "local";
type DiffLayout = "below" | "beside";

const SEARCH_DEBOUNCE_MS = 250;
const DIFF_LAYOUT_KEY = "pg-history-diff-layout";

/**
 * Rows from the end of the loaded list at which the next page is requested.
 * Matches the window's overscan so the fetch starts just before the user can
 * see the bottom, rather than after they hit it (#68 G11).
 */
const LOAD_MORE_SLACK = 8;

/// How many consecutive pages that add no *visible* rows auto-paging will fetch
/// before giving up. Bounds a starving client-side filter to a few pages instead
/// of a walk of the whole repository.
const MAX_BARREN_PAGES = 3;
/** Small debounce so arrow-scrolling the log doesn't fire a fetch per row. */
const INLINE_DIFF_DEBOUNCE_MS = 100;

export function HistoryScreen() {
  const commits = useRepoStore((s) => s.commits);
  const searchResults = useRepoStore((s) => s.searchResults);
  const searching = useRepoStore((s) => s.searching);
  const loadingMore = useRepoStore((s) => s.loadingMore);
  const loadMoreCommits = useRepoStore((s) => s.loadMoreCommits);
  // Whichever list is on screen has its own resume point (#68 G11).
  const hasMoreLog = useRepoStore((s) =>
    s.searchResults !== null ? s.searchCursor !== null : s.commitCursor !== null,
  );
  const searchCommits = useRepoStore((s) => s.searchCommits);
  const branches = useRepoStore((s) => s.branches);
  // Gates the graph drag: no starting a merge or rebase on top of an operation
  // the OperationBar is already showing (#91).
  const repoState = useRepoStore((s) => s.repoState);
  const logRef = useRepoStore((s) => s.logRef);
  const setLogRef = useRepoStore((s) => s.setLogRef);
  const loading = useRepoStore((s) => s.loading);
  // Multi-select over commit oids (classic list semantics, shared helper).
  // `lead` is the active end of the range — where plain ↑/↓ move from and where
  // Shift+↑/↓ extend — distinct from the anchor that clickSelection tracks.
  const [sel, setSel] = React.useState<Selection>(emptySelection);
  const [leadOid, setLeadOid] = React.useState<string | null>(null);
  // Free-text search box (supports key:value qualifiers — see logFilter.ts).
  const [filter, setFilter] = React.useState("");
  // Dedicated structured search fields.
  const [authorQ, setAuthorQ] = React.useState("");
  const [pathQ, setPathQ] = React.useState("");
  const [sinceDate, setSinceDate] = React.useState("");
  const [untilDate, setUntilDate] = React.useState("");
  // Content search (#61 D10) — git `-G`: matches lines the commit touched.
  const [contentQ, setContentQ] = React.useState("");
  const [contentRegex, setContentRegex] = React.useState(false);
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
        content: contentQ,
        contentRegex,
      }),
    [filter, authorQ, pathQ, sinceDate, untilDate, contentQ, contentRegex],
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
  const repo = useRepoStore((s) => s.current);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const ignoreWhitespace = useIgnoreWhitespace();
  // Below-layout panel height reuses the clamped/persisted pane-size hook.
  const detailHeight = usePaneWidth(320, {
    min: 140,
    max: 800,
    storageKey: "pg-history-diff-h",
  });
  // Width of the message column inside the below-layout detail panel.
  const messagePane = usePaneWidth(340, {
    min: 220,
    max: 640,
    storageKey: "pg-history-detail-msg-w",
  });
  const [diffLayout, setDiffLayout] = React.useState<DiffLayout>(() => {
    try {
      return localStorage.getItem(DIFF_LAYOUT_KEY) === "beside" ? "beside" : "below";
    } catch {
      return "below";
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(DIFF_LAYOUT_KEY, diffLayout);
    } catch {
      // quota errors are non-fatal
    }
  }, [diffLayout]);

  // Inline diff of the selected commit (its own change: parent..commit). Only
  // for a single selection — a multi-selection uses "View combined diff" (#54).
  const [inlineDiffs, setInlineDiffs] = React.useState<FileDiff[]>([]);
  const [inlineLoading, setInlineLoading] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const head = currentBranch(branches);
  const headName = head?.name ?? null;
  const headOid = head?.tip ?? null;
  // Resolved ONCE for the whole list: every row gets the same object reference,
  // which is what keeps PGCommitRow's memo effective (#68 G9).
  const headMarks = useSettingsStore((s) => s.headMarks);
  const headWeight = useSettingsStore((s) => s.headWeight);
  const headDecor = React.useMemo(
    () => resolveHeadDecor(headMarks, headWeight),
    [headMarks, headWeight],
  );
  const { onContextMenu: onCommitContext, menu: commitMenu } =
    useContextMenu<{ sha: string; subject: string }>(commitMenuItems);
  const { onContextMenu: onCommitMulti, menu: commitMultiMenu } =
    useContextMenu<string[]>((oids) => commitMultiMenuItems(oids));

  // Text/author/path/date/sha filtering happens on the backend (baseCommits),
  // and so is the "all"/"branch" scope (see the logRef effect below), so
  // hide-merges is all that is left client-side.
  const visible = React.useMemo(() => {
    let list: CommitInfo[] = baseCommits;
    if (hideMerges) list = list.filter((c) => c.parents.length <= 1);
    return list;
  }, [baseCommits, hideMerges]);

  // Ancestry pool for parent rewriting. The UNION matters: `searchResults` has
  // no intervening commits by construction, and `commits` may not reach as deep
  // as a narrow filter's oldest hit, so each supplies links the other lacks.
  const ancestry = React.useMemo(
    () => (searchResults ? [...commits, ...searchResults] : commits),
    [commits, searchResults],
  );

  const { rows: rawRows, maxCol } = React.useMemo(
    () => layoutGraph(visible, { ancestry, headOid: head?.tip ?? undefined }),
    [visible, ancestry, head?.tip],
  );

  // Re-layout on every search keystroke would otherwise hand each row a fresh
  // lanes/node object and re-render all 500 SVGs, even where nothing moved.
  const rowCache = React.useRef(createRowCache());
  const rows = React.useMemo(
    () => rowCache.current.stabilize(visible, rawRows),
    [visible, rawRows],
  );

  // Row pitch MUST come from the density token, not a literal — PGGraphRow
  // draws in SVG user units and the window steps by this same number (#70).
  const rowH = COMMIT_ROW_BASE_H + useDensityStep();
  const win = useWindowedList({ count: visible.length, rowHeight: rowH });

  // Fetch the next page as the window reaches the end of the loaded list.
  // Driven by the window rather than a scroll listener so there is one source
  // of truth for "where the user is" (#68 G11 on top of G10).
  //
  // Bounded on purpose. `visible` is the CLIENT-side-filtered list, and a filter
  // can hold it shorter than the window indefinitely — hide-merges can starve
  // it however many pages the walk yields. The
  // end-of-list condition is then satisfied at rest with no scrolling, and
  // `loadMoreCommits` toggling `loadingMore` re-arms this effect after every
  // page, so it would walk the entire repository a page at a time. Allow a few
  // consecutive pages that add no visible rows (a sparse filter legitimately has
  // to dig for matches), then stop until something actually changes.
  const autoPage = React.useRef({ barren: 0, sawVisible: -1, sawBase: -1 });
  React.useEffect(() => {
    // Any change to what is being filtered is a fresh start.
    autoPage.current = { barren: 0, sawVisible: -1, sawBase: -1 };
  }, [filterKind, hideMerges, searchResults]);

  React.useEffect(() => {
    if (!hasMoreLog || loadingMore) return;
    if (win.end < visible.length - LOAD_MORE_SLACK) return;

    const st = autoPage.current;
    if (st.sawBase >= 0) {
      if (visible.length > st.sawVisible) st.barren = 0;
      else if (baseCommits.length > st.sawBase) st.barren += 1;
    }
    if (st.barren >= MAX_BARREN_PAGES) return;

    st.sawVisible = visible.length;
    st.sawBase = baseCommits.length;
    void loadMoreCommits();
  }, [
    win.end,
    visible.length,
    baseCommits.length,
    hasMoreLog,
    loadingMore,
    loadMoreCommits,
  ]);

  const graphW = graphWidth(maxCol);
  const graphClamped = isGraphClamped(maxCol);
  const hiddenLanes = graphClamped ? maxCol - maxVisibleCol() : 0;

  // Visible row order (oids) — the axis shift-ranges and pruning work over.
  const order = React.useMemo(() => visible.map((c) => c.oid), [visible]);

  // Drop selected oids that left the visible list (search/filter/refresh/repo
  // switch); re-home the lead to the top and keep at least one row selected so
  // the detail pane always has a subject. Replaces the old setSelected(0) reset.
  React.useEffect(() => {
    const valid = new Set(order);
    setSel((prev) => {
      const pruned = pruneSelection(prev, valid);
      if (pruned.keys.length === 0 && order.length > 0) {
        return { keys: [order[0]], anchor: order[0] };
      }
      return pruned;
    });
    setLeadOid((prev) => (prev && valid.has(prev) ? prev : (order[0] ?? null)));
  }, [order]);

  const cursorIdx = Math.max(
    0,
    order.indexOf(leadOid ?? primarySelectedKey(sel) ?? order[0]),
  );
  const clampIdx = (i: number) => Math.max(0, Math.min(order.length - 1, i));
  const moveTo = (i: number, range: boolean) => {
    const oid = order[clampIdx(i)];
    if (!oid) return;
    setSel((prev) => clickSelection(order, prev, oid, { range }));
    setLeadOid(oid);
  };

  // Enter / "View combined diff": one commit → its own diff full-screen
  // (commit-self, matching the inline panel — not commit-vs-HEAD); 2+ →
  // combined diff of the whole selection (parent-of-oldest → newest).
  const setNavIntent = useNavStore((s) => s.setIntent);
  const activateSelection = React.useCallback(() => {
    if (sel.keys.length > 1) {
      const plan = planCommitSelection(commits, sel.keys);
      if (plan)
        setNavIntent({
          kind: "commit-vs-commit",
          from: plan.baseOid ?? plan.oldestOid,
          to: plan.newestOid,
        });
      return;
    }
    const oid = primarySelectedKey(sel) ?? order[cursorIdx];
    if (oid) setNavIntent({ kind: "commit-self", oid });
  }, [sel, commits, order, cursorIdx, setNavIntent]);

  // Keyboard: ↑/↓ move a single cursor, Shift+↑/↓ extend the range, Enter opens
  // the commit's diff (combined diff for a multi-selection).
  usePaneList({
    paneId: "history.list",
    count: visible.length,
    selectedIndex: cursorIdx,
    onSelect: (i) => moveTo(i, false),
    onExtendUp: () => moveTo(cursorIdx - 1, true),
    onExtendDown: () => moveTo(cursorIdx + 1, true),
    onActivate: activateSelection,
    searchText: (i) => visible[i]?.summary ?? "",
    // The list is windowed, so the selected row is often unmounted and the
    // hook's DOM-query fallback would find nothing (#68 G10).
    scrollToIndex: win.scrollToIndex,
  });

  // Single-selection commit whose own diff (parent..commit) feeds the inline
  // panel; null while multi-selecting (that path uses the combined diff).
  const inlineOid =
    sel.keys.length > 1 ? null : (primarySelectedKey(sel) ?? order[cursorIdx] ?? null);
  // Cancellable + debounced so rapid ↑/↓ through the log doesn't flood libgit2.
  React.useEffect(() => {
    if (!repo || !inlineOid) {
      setInlineDiffs([]);
      setInlineError(null);
      setInlineLoading(false);
      return;
    }
    let cancelled = false;
    setInlineLoading(true);
    setInlineError(null);
    const handle = window.setTimeout(() => {
      diffCommit(repo.id, inlineOid, diffContextLines, ignoreWhitespace)
        .then((d) => { if (!cancelled) setInlineDiffs(d); })
        .catch((e) => {
          if (!cancelled) { setInlineDiffs([]); setInlineError(appErrorMessage(e)); }
        })
        .finally(() => { if (!cancelled) setInlineLoading(false); });
    }, INLINE_DIFF_DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [repo?.id, inlineOid, diffContextLines, ignoreWhitespace]);

  const exportVisible = React.useCallback(() => {
    const lines = visible.map(
      (c) =>
        `${c.shortOid}  ${new Date(c.timestamp * 1000).toISOString()}  ${c.author} <${c.email}>  ${c.summary}`,
    );
    navigator.clipboard?.writeText(lines.join("\n"));
    pgFlash(`copied ${visible.length} commit${visible.length === 1 ? "" : "s"}`);
  }, [visible]);

  // Log-source options: all branches (the default walk), HEAD alone, then every
  // local branch. The selection scopes the backend log itself, so
  // unmerged-branch commits are browsable (and cherry-pickable) — see setLogRef
  // in useRepoStore.
  const logRefOptions = React.useMemo(
    () => [
      { value: LOG_REF_ALL, label: "All branches" },
      { value: "", label: "HEAD" },
      ...branches
        .filter((b) => !b.isRemote)
        .map((b) => ({ value: b.name, label: b.name })),
    ],
    [branches],
  );

  // The All / This branch group is a SCOPE, not a client-side sieve: "All"
  // walks every branch, "This branch" walks HEAD alone.
  //
  // Only a CHANGE of scope rescopes the walk. Reacting to `logRef` instead
  // would fight the ref selector next door: picking a branch (or HEAD) by hand
  // leaves the group where it was, and the effect would immediately drag the
  // log back. On mount the group is "All" and the store already defaults to
  // every branch, so nothing refetches.
  const appliedScope = React.useRef<HistoryFilterKind | null>(null);
  React.useEffect(() => {
    if (appliedScope.current === filterKind) return;
    appliedScope.current = filterKind;
    const target = filterKind === "branch" ? null : LOG_REF_ALL;
    if (useRepoStore.getState().logRef !== target) void setLogRef(target);
  }, [filterKind, setLogRef]);

  const toolbarRight = (
    <HistoryToolbarRight
      logRef={logRef}
      logRefOptions={logRefOptions}
      onLogRef={(v) => void setLogRef(v)}
      refFilter={refFilter}
      onRefFilter={setRefFilter}
      hideMerges={hideMerges}
      onHideMerges={setHideMerges}
      diffLayout={diffLayout}
      onToggleDiffLayout={() =>
        setDiffLayout((l) => (l === "below" ? "beside" : "below"))
      }
      onExport={exportVisible}
    />
  );
  const clearSearch = React.useCallback(() => {
    setFilter("");
    setAuthorQ("");
    setPathQ("");
    setSinceDate("");
    setUntilDate("");
    // Content too, or Clear leaves a live filter behind (#61 D10).
    setContentQ("");
    setContentRegex(false);
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
      contentQ={contentQ}
      onContentQ={setContentQ}
      contentRegex={contentRegex}
      onContentRegex={setContentRegex}
    />
  ) : null;

  // Everything below stays ABOVE the empty-log early return: opening a repo
  // renders this screen once with no commits and again once the log lands, and
  // a hook that only runs on the second render aborts the whole React root
  // ("rendered more hooks than during the previous render"), which showed up
  // as a window with nothing in it at all.
  const primaryOid = primarySelectedKey(sel);
  const current =
    visible.find((c) => c.oid === primaryOid) ?? visible[cursorIdx] ?? visible[0];
  const selectedSet = new Set(sel.keys);
  const multiSelected = sel.keys.length > 1;

  // Both row handlers are shared across every row and stable across renders —
  // a fresh closure per row would defeat PGCommitRow's memo entirely (#68 G9).
  const onRowClick = React.useCallback(
    (oid: string, e: React.MouseEvent) => {
      setSel((prev) =>
        clickSelection(order, prev, oid, {
          toggle: e.metaKey || e.ctrlKey,
          range: e.shiftKey,
        }),
      );
      setLeadOid(oid);
    },
    [order],
  );

  // Oid → commit, so the context handler can take an oid like the click one.
  const byOid = React.useMemo(
    () => new Map(visible.map((c) => [c.oid, c])),
    [visible],
  );

  // Ref pills, built once per commit instead of twice per row per render
  // (mapCommitRefs allocated an array, then .filter() allocated another).
  const refsByOid = React.useMemo(() => {
    const m = new Map<string, CommitRef[]>();
    for (const c of visible) {
      const all = mapCommitRefs(c.refs, headName);
      m.set(c.oid, refFilter === "local" ? all.filter((r) => !r.remote) : all);
    }
    return m;
  }, [visible, headName, refFilter]);

  const onRowContext = React.useCallback(
    (oidClicked: string, e: React.MouseEvent) => {
      const c = byOid.get(oidClicked);
      if (!c) return;
      if (multiSelected && selectedSet.has(c.oid)) {
        onCommitMulti(e, sel.keys);
        return;
      }
      // Right-clicking outside the selection collapses to that row first.
      setSel(clickSelection(order, sel, c.oid, {}));
      setLeadOid(c.oid);
      onCommitContext(e, { sha: c.oid, subject: c.summary });
    },
    [byOid, multiSelected, selectedSet, sel, order, onCommitMulti, onCommitContext],
  );

  // ── Graph drag (#91) ──────────────────────────────────────────────────────
  //
  // ONE source and ONE delegated zone for the whole list. Per-row hooks are not
  // an option here: PGCommitRow is memoized and the list is windowed (#68 G9),
  // so a store subscription per row would re-render the visible slice on every
  // pointer move. Rows are found by attributes they already carry —
  // `[data-pg-ref]` on a ref pill, `[data-sha]` on a row — and the hover ring is
  // an attribute the controller writes, never React state.
  const dragSource = useDragSource(
    React.useCallback(
      (target: HTMLElement): DragPayload | null => {
        const pill = target.closest("[data-pg-ref]") as HTMLElement | null;
        const ref = pill?.getAttribute("data-pg-ref");
        // The pill wins over the row it sits in: grabbing a branch label means
        // the branch, not the commit underneath it.
        if (ref) {
          return { kind: "ref", ref, isHead: ref === headName, label: ref };
        }
        const rowEl = target.closest("[data-sha]") as HTMLElement | null;
        const shortOid = rowEl?.getAttribute("data-sha");
        if (!shortOid) return null;
        const c = visible.find((x) => x.shortOid === shortOid);
        if (!c) return null;
        return { kind: "commit", oid: c.oid, label: c.shortOid };
      },
      [headName, visible],
    ),
  );

  /** The ref pill or commit row under the pointer, and what dropping there means. */
  const resolveTarget = React.useCallback(
    (el: HTMLElement, payload: DragPayload): DropResolution | null => {
      const pill = el.closest("[data-pg-ref]") as HTMLElement | null;
      const rowEl = el.closest("[data-sha]") as HTMLElement | null;
      let target: GraphDropTarget | null = null;
      let markEl: HTMLElement | null = null;
      if (pill?.getAttribute("data-pg-ref")) {
        target = { kind: "ref", ref: pill.getAttribute("data-pg-ref")! };
        markEl = pill;
      } else if (rowEl?.getAttribute("data-sha")) {
        const c = visible.find((x) => x.shortOid === rowEl.getAttribute("data-sha"));
        if (!c) return null;
        target = { kind: "commit", oid: c.oid, shortOid: c.shortOid };
        markEl = rowEl;
      }
      if (!target || !markEl) return null;
      const drop = resolveGraphDrop(payload, target, { headBranch: headName, headOid });
      if (!drop) return null;
      if (drop.kind === "rejected")
        return { key: "", el: markEl, reason: drop.reason };
      // The key round-trips the decision so onDrop does not resolve twice — the
      // pointer may have moved on by the time the confirm resolves.
      return { key: JSON.stringify(drop), el: markEl };
    },
    [visible, headName, headOid],
  );

  const onGraphDrop = React.useCallback(
    async (_payload: DragPayload, key: string) => {
      if (!key) return;
      const drop = JSON.parse(key) as ReturnType<typeof resolveGraphDrop>;
      if (!drop || drop.kind === "rejected") return;
      const store = useRepoStore.getState();
      const head = headName ?? "the current branch";
      if (drop.kind === "merge") {
        if (
          await pgConfirm({
            title: `Merge ${drop.branch} into ${head}?`,
            body: `A merge commit is created on ${head} unless the merge fast-forwards.`,
            confirmLabel: "Merge",
          })
        )
          void store.mergeBranch(drop.branch);
        return;
      }
      if (drop.kind === "rebase") {
        if (
          await pgConfirm({
            title: `Rebase ${head} onto ${drop.label}?`,
            body: `${head}'s commits are replayed on top of ${drop.label} — their SHAs change.`,
            confirmLabel: "Rebase",
            danger: true,
          })
        )
          void store.rebaseOnto(drop.upstream);
        return;
      }
      if (
        await pgConfirm({
          title: `Cherry-pick ${drop.label} onto ${head}?`,
          body: `The commit is copied onto ${head} as a new commit with a new SHA.`,
          confirmLabel: "Cherry-pick",
          danger: true,
        })
      )
        void store.cherryPick(drop.oid);
    },
    [headName],
  );

  const graphZone = useDropZone({
    id: "history.graph",
    // No starting a merge or a rebase on top of an operation already open — the
    // OperationBar owns that state and it must be finished or aborted first.
    accepts: (p) => (p.kind === "ref" || p.kind === "commit") && repoState === "Clean",
    resolve: resolveTarget,
    onDrop: (p, key) => {
      void onGraphDrop(p, key);
    },
    onReject: (_p, reason) => pgFlash(reason),
  });

  if (!commits.length) {
    return (
      <>
        <PGToolbar left={toolbarLeft} right={toolbarRight} />
        {advancedPanel}
        {loading ? (
          // Initial load only — this branch is reached solely when no commits
          // are on screen yet. A page-append must never blank the list the
          // user is already reading (#61 B6).
          <div
            style={{ padding: "6px 12px" }}
            aria-busy="true"
            aria-label="Loading commits"
          >
            <PGSkeleton count={12} rowStep />
          </div>
        ) : (
          <PGEmpty icon="history" title="No commits yet">
            This repository doesn&apos;t have any commits on HEAD.
          </PGEmpty>
        )}
      </>
    );
  }

  const listPane = (
    <PGPane
      id="history.list"
      primary
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        data-testid="commit-header"
        style={{
          display: "grid",
          gridTemplateColumns: commitRowGrid(graphW),
          height: "calc(24px + var(--row-step))",
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
        {/* No "GRAPH" caption — the gutter is narrow and the word collided
            with SHA. The count of lanes that did not fit still belongs here,
            in text: the gutter is a decorative graphic, and Phase 3 (G8)
            marks it aria-hidden, so a fade alone would state this nowhere. */}
        <span style={{ paddingLeft: 12 }}>{hiddenLanes > 0 ? `+${hiddenLanes}` : ""}</span>
        <span>SHA</span>
        <span>SUBJECT</span>
        <span>AUTHOR</span>
        <span>DATE</span>
      </div>
      <FocusableScroll
        style={{ flex: 1 }}
        ariaLabel="Commit list"
        innerRef={win.viewportRef}
        onScroll={win.onScroll}
      >
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
        {/* Windowed: only the on-screen slice is mounted, with spacer divs
            above and below so scrollHeight stays exact — FocusableScroll's
            End/PageDn read scrollHeight and clientHeight (#68 G10). */}
        <div
          data-testid="commit-list"
          data-total={visible.length}
          ref={graphZone.ref}
          {...dragSource}
        >
        <div style={{ height: win.topPad }} />
        {visible.slice(win.start, win.end).map((c, sliceIndex) => {
          const g = rows[win.start + sliceIndex];
          return (
            <PGCommitRow
              key={c.oid}
              graphW={graphW}
              clamped={graphClamped}
              lanes={g?.lanes}
              node={g?.node}
              sha={c.shortOid}
              message={c.summary}
              author={c.author || "unknown"}
              date={relativeTime(c.timestamp)}
              refs={refsByOid.get(c.oid)}
              selected={selectedSet.has(c.oid)}
              isHead={c.oid === headOid}
              headDecor={headDecor}
              oid={c.oid}
              onRowClick={onRowClick}
              onRowContext={onRowContext}
            />
          );
        })}
        <div style={{ height: win.bottomPad }} />
        </div>
        {/* The log used to just stop at 500 with no signal. Now the bottom
            either says it is still fetching, or genuinely is the end. */}
        {loadingMore && (
          <div
            data-testid="log-loading-more"
            style={{
              padding: "8px 12px",
              textAlign: "center",
              color: "var(--fg-3)",
              fontSize: "var(--fs-11)",
            }}
          >
            Loading older commits…
          </div>
        )}
      </FocusableScroll>
    </PGPane>
  );

  // "parent → commit" label above the single-commit inline file list.
  const diffHeader = current
    ? current.parents.length > 0
      ? `${shortSha(current.parents[0])} → ${current.shortOid}`
      : `(root) → ${current.shortOid}`
    : "";

  // Message + actions, sized by whoever mounts it. The message scrolls on its
  // own and the action row is pinned below it, so an arbitrarily long commit
  // body can never push the buttons — or the diff — out of the panel.
  const messageBlock = current && (
    <>
      <FocusableScroll
        ariaLabel="Commit message"
        testId="history-detail-message"
        style={{ flex: 1, minHeight: 0 }}
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
      </FocusableScroll>
      <CommitActionRow commit={current} />
    </>
  );

  const diffBlock = (
    <CommitDiffPanel
      diffs={inlineDiffs}
      loading={inlineLoading}
      error={inlineError}
      header={diffHeader}
      paneIdPrefix="history.diff"
      // The inline panel shows the selected commit's own diff; a multi-selection
      // renders MultiCommitDetail instead, so this is always one commit (#61 D6).
      verifyOid={current?.oid}
      // The inline panel shows one commit's own diff, so the old side is its
      // parent — `^` fails harmlessly on a root commit, which has no old side.
      syntaxSides={
        repo && current
          ? {
              repoId: repo.id,
              old: { kind: "rev", rev: `${current.oid}^` },
              new: { kind: "rev", rev: current.oid },
            }
          : undefined
      }
    />
  );

  const detailContent = multiSelected ? (
    <MultiCommitDetail oids={sel.keys} onCombinedDiff={activateSelection} />
  ) : current ? (
    diffLayout === "below" ? (
      // Bottom panel is wide and short: message beside the diff, each with its
      // own scroll, so neither one starves the other vertically.
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
        <div
          style={{
            width: messagePane.width,
            flexShrink: 0,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {messageBlock}
        </div>
        <PGResizeHandle side="right" onDrag={(d) => messagePane.resize(d)} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--border-0)",
          }}
        >
          {diffBlock}
        </div>
      </div>
    ) : (
      // Side panel is narrow and tall: keep the stack, but cap the message at
      // half the height and let it scroll rather than overflow.
      <>
        <div
          style={{
            flexShrink: 0,
            maxHeight: "50%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {messageBlock}
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
          {diffBlock}
        </div>
      </>
    )
  ) : null;

  const showDetail = multiSelected || !!current;

  return (
    <>
      <PGToolbar left={toolbarLeft} right={toolbarRight} />
      {advancedPanel}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: diffLayout === "below" ? "column" : "row",
        }}
      >
        {listPane}
        {showDetail && diffLayout === "beside" && (
          <>
            <PGResizeHandle onDrag={(d) => detailPane.resize(-d)} side="left" />
            <div
              data-testid="history-detail"
              style={{
                width: detailPane.width,
                flexShrink: 0,
                borderLeft: "1px solid var(--border-0)",
                background: "var(--bg-1)",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              {detailContent}
            </div>
          </>
        )}
        {showDetail && diffLayout === "below" && (
          <>
            <PGResizeHandle
              orientation="vertical"
              side="top"
              onDrag={(d) => detailHeight.resize(-d)}
            />
            <div
              data-testid="history-detail"
              style={{
                height: detailHeight.width,
                flexShrink: 0,
                borderTop: "1px solid var(--border-0)",
                background: "var(--bg-1)",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              {detailContent}
            </div>
          </>
        )}
      </div>
      {commitMenu}
      {commitMultiMenu}
    </>
  );
}

/**
 * Detail pane for a multi-commit selection: a summary, the selected commits,
 * and the multi-commit actions (combined diff, cherry-pick set, squash range,
 * copy SHAs). Ancestry gating comes from the full log via planCommitSelection.
 */
function MultiCommitDetail({
  oids,
  onCombinedDiff,
}: {
  oids: string[];
  onCombinedDiff: () => void;
}) {
  const commits = useRepoStore((s) => s.commits);
  const branches = useRepoStore((s) => s.branches);
  const plan = React.useMemo(
    () => planCommitSelection(commits, oids),
    [commits, oids],
  );
  // Squash — and only squash — is defined over HEAD's ancestry: it rewrites the
  // current branch. Combined diff and cherry-pick deliberately work on any
  // commit in the log, which since the all-branches default includes commits
  // HEAD cannot reach (that is the point of cherry-picking one).
  const ancestry = React.useMemo(
    () => headAncestryOf(commits, branches),
    [commits, branches],
  );
  const squashPlan = React.useMemo(
    () => planCommitSelection(ancestry, oids),
    [ancestry, oids],
  );
  const byOid = React.useMemo(
    () => new Map(commits.map((c) => [c.oid, c])),
    [commits],
  );
  if (!plan) return null;
  const n = plan.oids.length;

  // Gated on the ANCESTRY plan: a selection can now span branches, and squash
  // may only rewrite what the current branch actually contains.
  const squashBlock =
    !squashPlan || squashPlan.oids.length !== n
      ? "selection isn't all on this branch"
      : !squashPlan.contiguous
        ? "non-contiguous selection"
        : squashPlan.hasMerge
          ? "selection contains a merge"
          : !squashPlan.baseOid
            ? "oldest commit is the root"
            : null;

  const cherryPickSet = async () => {
    if (
      await pgConfirm({
        title: `Cherry-pick ${n} commits onto the current branch?`,
        body: "They are applied oldest first.",
        confirmLabel: "Cherry-pick",
      })
    )
      useRepoStore.getState().cherryPickMany(plan.oids);
  };
  const squashSet = async () => {
    if (squashBlock || !squashPlan?.baseOid) return;
    const msg = await pgPrompt({
      title: `Squash ${n} commits into one`,
      body: "Message for the combined commit — every squashed message, oldest first.",
      confirmLabel: "Squash",
      requireValue: true,
      initialValue: combinedSquashMessage(squashPlan.oids, byOid),
      multiline: 8,
    });
    if (!msg) return;
    const rebasePlan = buildRebasePlan(ancestry, squashPlan.baseOid, {
      kind: "squash-range",
      oids: squashPlan.oids,
      message: msg,
    });
    if (!rebasePlan) return;
    // Runs here rather than handing over a plan to press Start on — see
    // runRebasePlanNow. The context menu's Squash takes the same path.
    const outcome = await runRebasePlanNow(rebasePlan);
    if (outcome === "done") pgFlash(`squashed ${n} commits`);
    else if (outcome === "paused") pgFlash("squash paused — see the Conflicts screen");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div
        style={{
          padding: "12px 12px 4px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-13)",
          color: "var(--fg-0)",
        }}
      >
        {n} commits selected
      </div>
      {/* A combined diff is a RANGE diff: parent-of-oldest → newest, which is the
          only thing two trees can be compared as. So a selection that is not an
          unbroken first-parent chain silently includes whatever sits between the
          picked commits, and until now nothing said so (#158). Keyed on
          plan.contiguous rather than a count: "how many commits are in the range"
          cannot be answered from the loaded log, which is a graph-ordered PREFIX
          of history across every branch (#68 G11) — a number derived from row
          distance would be confidently wrong. */}
      {!plan.contiguous && (
        <div
          data-testid="multi-range-note"
          style={{
            padding: "0 12px 6px",
            fontSize: "var(--fs-12)",
            color: "var(--fg-2)",
          }}
        >
          Combined diff covers the whole range{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {shortSha(plan.baseOid ?? plan.oldestOid)}..{shortSha(plan.newestOid)}
          </span>
          , including commits between the selected ones.
        </div>
      )}
      <div
        style={{
          padding: "0 12px 10px",
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        <PGButton size="sm" variant="outline" icon="diff" onClick={onCombinedDiff}>
          View combined diff
        </PGButton>
        <PGButton
          size="sm"
          variant="outline"
          icon="rebase"
          data-testid="multi-cherry-pick"
          onClick={cherryPickSet}
        >
          Cherry-pick {n}
        </PGButton>
        <PGButton
          size="sm"
          variant="outline"
          icon="squash"
          data-testid="multi-squash"
          disabled={!!squashBlock}
          title={squashBlock ? `Can't squash: ${squashBlock}` : undefined}
          onClick={squashSet}
        >
          Squash {n}
        </PGButton>
        <PGButton
          size="sm"
          variant="ghost"
          icon="copy"
          onClick={() => {
            navigator.clipboard?.writeText(plan.oids.join("\n"));
            pgFlash(`copied ${n} SHAs`);
          }}
        >
          Copy SHAs
        </PGButton>
      </div>
      <FocusableScroll
        ariaLabel="Selected commits"
        style={{
          flex: 1,
          minHeight: 0,
          borderTop: "1px solid var(--border-0)",
          padding: "8px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {/* Newest→oldest, matching the list above. */}
        {plan.oids
          .slice()
          .reverse()
          .map((oid) => {
            const c = byOid.get(oid);
            return (
              <div key={oid} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "var(--accent)" }}>
                  {c?.shortOid ?? oid.slice(0, 7)}
                </span>
                <span
                  style={{
                    color: "var(--fg-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c?.summary ?? ""}
                </span>
              </div>
            );
          })}
      </FocusableScroll>
    </div>
  );
}

function CommitActionRow({ commit }: { commit: CommitInfo }) {
  const store = useRepoStore;
  const branchHere = React.useCallback(async () => {
    const name = await pgPrompt({
      title: "Create branch here",
      body: `Branching at ${commit.shortOid}.`,
      placeholder: "feat/my-branch",
      confirmLabel: "Create",
      requireValue: true,
      mono: true,
    });
    if (!name) return;
    store.getState().createBranch(name, commit.oid);
  }, [commit, store]);
  // One dialog rather than two chained prompts: signing is a third value, and a
  // prompt chain cannot express "blank annotation means lightweight, which is
  // also why signing is unavailable" while you are answering it (#132).
  const tagHere = React.useCallback(() => {
    void openCreateTag({ oid: commit.oid, shortOid: commit.shortOid });
  }, [commit]);
  const cherryPick = React.useCallback(async () => {
    if (
      !(await pgConfirm({
        title: `Cherry-pick ${commit.shortOid} onto the current branch?`,
        confirmLabel: "Cherry-pick",
      }))
    )
      return;
    store.getState().cherryPick(commit.oid);
  }, [commit, store]);
  const revert = React.useCallback(async () => {
    if (
      !(await pgConfirm({
        title: `Revert ${commit.shortOid}?`,
        body: "A new commit undoing its changes is created; history is not rewritten.",
        confirmLabel: "Revert",
      }))
    )
      return;
    store.getState().revert(commit.oid);
  }, [commit, store]);
  return (
    // Pinned below the scrolling message, never scrolled out of reach.
    <div
      style={{
        padding: "8px 12px 10px",
        borderTop: "1px solid var(--border-0)",
        flexShrink: 0,
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
      <PGButton
        size="sm"
        variant="outline"
        icon="commit"
        data-testid="commit-cherry-pick"
        onClick={cherryPick}
      >
        Cherry-pick
      </PGButton>
      <PGButton
        size="sm"
        variant="outline"
        icon="x"
        data-testid="commit-revert"
        onClick={revert}
      >
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
        testId="history-search"
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
  contentQ: string;
  onContentQ: (v: string) => void;
  contentRegex: boolean;
  onContentRegex: (v: boolean) => void;
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
    contentQ,
    onContentQ,
    contentRegex,
    onContentRegex,
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
      {/*
        Labelled "Changed lines contain", not "pickaxe": this is git's -G
        (the text was touched), not -S (the occurrence count changed), and the
        UI must not oversell it (#61 D10).
      */}
      <SearchField label="Changed lines contain">
        <PGInput
          value={contentQ}
          onChange={onContentQ}
          placeholder="needle"
          icon="search"
          size="sm"
          mono
          style={{ width: 220 }}
          data-testid="history-content-q"
        />
      </SearchField>
      <SearchField label="Regex">
        <PGButton
          size="sm"
          variant={contentRegex ? "outline" : "ghost"}
          aria-pressed={contentRegex}
          title="Treat the content pattern as a regular expression"
          onClick={() => onContentRegex(!contentRegex)}
          style={contentRegex ? { color: "var(--accent)" } : undefined}
        >
          .*
        </PGButton>
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
  logRef,
  logRefOptions,
  onLogRef,
  refFilter,
  onRefFilter,
  hideMerges,
  onHideMerges,
  diffLayout,
  onToggleDiffLayout,
  onExport,
}: {
  logRef: string | null;
  logRefOptions: { value: string; label: string }[];
  onLogRef: (v: string | null) => void;
  refFilter: RefFilter;
  onRefFilter: (v: RefFilter) => void;
  hideMerges: boolean;
  onHideMerges: (v: boolean) => void;
  diffLayout: DiffLayout;
  onToggleDiffLayout: () => void;
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
        value={logRef ?? ""}
        onChange={(v) => onLogRef(v === "" ? null : v)}
        options={logRefOptions}
        size="sm"
        title="Which commits to walk — all branches, HEAD, or one branch"
        data-testid="history-ref-select"
      />
      <PGSelect
        value={refFilter}
        onChange={(v) => onRefFilter(v as RefFilter)}
        options={[
          // Labels say "labels", not "refs": this picks which ref BADGES ride
          // the rows, and next to the scope selector "All refs" read as a
          // second scope control.
          { value: "all", label: "All labels" },
          { value: "local", label: "Local labels" },
        ]}
        size="sm"
        title="Ref labels shown on commit rows"
      />
      <PGIconButton
        icon="filter"
        size="md"
        title="Filter"
        onClick={(e) => openAt(e.clientX, e.clientY + 4, null)}
      />
      <PGIconButton
        icon="diff"
        size="md"
        title={
          diffLayout === "below"
            ? "Diff panel below — switch to beside"
            : "Diff panel beside — switch to below"
        }
        aria-pressed={diffLayout === "beside"}
        data-testid="history-diff-layout"
        onClick={onToggleDiffLayout}
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
