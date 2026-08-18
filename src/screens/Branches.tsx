import React, { type CSSProperties } from "react";
import {
  PGBadge,
  PGButton,
  PGButtonGroup,
  PGEmpty,
  PGIcon,
  PGIconButton,
  PGResizeHandle,
  PGSearchInput,
  PGToolbar,
  KV,
  branchMenuItems,
  pgConfirm,
  pgPrompt,
  remoteBranchMenuItems,
  stashMenuItems,
  openStashDiff,
  openStashVsWorktree,
  promptStashRename,
  type StashMenuTarget,
  tagMenuItems,
  useContextMenu,
  usePaneSize,
} from "@/design";
import { useElementSize } from "@/lib/useElementSize";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { orderBranches } from "@/features/branches/orderBranches";
import { TagSignatureBadge } from "@/features/signing/TagSignatureBadge";
import { PGPane, FocusableScroll, usePaneList } from "@/features/keymap";
import type { BranchInfo, StashInfo, TagInfo } from "@/lib/types";
// `tip` is a full oid (see list_branches); these two rows show it short.
import { shortSha } from "@/lib/derive";

type Selection =
  | { kind: "branch"; name: string }
  | { kind: "tag"; name: string }
  | { kind: "stash"; index: number };

const COLS = [
  { key: "icon", label: "", initial: 20, min: 20, resizable: false },
  { key: "name", label: "NAME", initial: 280, min: 120, resizable: true },
  { key: "tip", label: "TIP", initial: 120, min: 80, resizable: true },
  { key: "upstream", label: "UPSTREAM", initial: 200, min: 100, resizable: true },
  { key: "status", label: "STATUS", initial: 140, min: 80, resizable: true },
  { key: "actions", label: "", initial: 40, min: 40, resizable: false },
];

export function BranchesScreen() {
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);
  const stashes = useRepoStore((s) => s.stashes);
  const activity = useRepoStore((s) => s.activity);
  const fetchAllOp = useRepoStore((s) => s.fetchAll);
  const createAndSwitchBranch = useRepoStore((s) => s.createAndSwitchBranch);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [filter, setFilter] = React.useState("");
  const [view, setView] = React.useState<
    "all" | "local" | "remote" | "tags" | "stashes"
  >("all");

  const startCreate = async () => {
    const raw = await pgPrompt({
      title: "New branch",
      body: "Created from the current HEAD and checked out.",
      placeholder: "feat/my-branch",
      confirmLabel: "Create",
      requireValue: true,
      mono: true,
    });
    if (!raw) return;
    const name = raw.trim();
    if (!name) return;
    void createAndSwitchBranch(name, { autoStash: true });
  };

  React.useEffect(() => {
    setSelection(null);
  }, [view]);

  const { onContextMenu: onBranchCtx, menu: branchMenu } = useContextMenu<
    BranchInfo & { kind: "local" | "remote" }
  >((b) =>
    b?.kind === "remote"
      ? remoteBranchMenuItems({ name: b.name })
      : branchMenuItems({
          name: b?.name,
          current: b?.isHead,
          upstream: b?.upstream,
        }),
  );
  const { onContextMenu: onTagCtx, menu: tagMenu } = useContextMenu<TagInfo>(
    (t) => tagMenuItems({ name: t?.name, sha: t?.shortOid, oid: t?.oid }),
  );
  const { onContextMenu: onStashCtx, menu: stashMenu } =
    useContextMenu<StashMenuTarget>((s) => stashMenuItems(s));

  const [widths, setWidths] = React.useState(() => COLS.map((c) => c.initial));
  const gridTemplate = widths.map((w) => `${w}px`).join(" ");
  // The refs table keeps its five columns readable; beyond that the inspector may
  // take whatever the window offers (#162).
  const layout = useElementSize();
  const inspectorPane = usePaneSize(320, {
    axis: "width",
    container: layout,
    min: 220,
    siblingMin: 420,
    storageKey: "pg-branches-inspector-w",
  });
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[i];
    const min = COLS[i].min;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setWidths((prev) => {
        const next = [...prev];
        next[i] = Math.max(min, startW + dx);
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const rows = React.useMemo(() => {
    if (view === "tags" || view === "stashes") return [];
    const list = branches.map((b) => ({
      ...b,
      kind: b.isRemote ? ("remote" as const) : ("local" as const),
    }));
    // Filter first, order second (#135) — ordering only permutes, so the pinned
    // default branch cannot reappear once the filter has excluded it. Each kind
    // is ordered WITHIN its group so the `all` view still lists locals before
    // remotes rather than interleaving them by tip time.
    const filtered = list.filter((b) => b.name.includes(filter));
    const locals = orderBranches(filtered.filter((b) => b.kind === "local"));
    const remotes = orderBranches(filtered.filter((b) => b.kind === "remote"));
    if (view === "local") return locals;
    if (view === "remote") return remotes;
    return [...locals, ...remotes];
  }, [branches, filter, view]);

  const visibleTags = React.useMemo(() => {
    if (view === "stashes") return [];
    if (view === "tags" || view === "all")
      return tags.filter((t) => t.name.includes(filter));
    return [];
  }, [tags, filter, view]);

  const visibleStashes = React.useMemo(() => {
    if (view === "stashes" || view === "all")
      return stashes.filter(
        (s) =>
          s.message.includes(filter) || `stash@{${s.index}}`.includes(filter),
      );
    return [];
  }, [stashes, filter, view]);

  // Keyboard: one selection across the rendered order (branches, tags,
  // stashes). Enter checks out the selected local branch.
  const flatRefs = React.useMemo<Selection[]>(
    () => [
      ...rows.map((b) => ({ kind: "branch" as const, name: b.name })),
      ...visibleTags.map((t) => ({ kind: "tag" as const, name: t.name })),
      ...visibleStashes.map((s) => ({ kind: "stash" as const, index: s.index })),
    ],
    [rows, visibleTags, visibleStashes],
  );
  // -1 when nothing is selected, and it must STAY -1: this used to clamp to 0,
  // so `list.activate` checked out row 0 while no row had ever appeared
  // highlighted. `branches.list` is the screen's primary pane, so entering the
  // screen focuses it — Enter was one keystroke away from checking out
  // whatever sorted first, which since #135 is the pinned default branch.
  // `usePaneList` handles -1: arrowing either way lands on row 0, and
  // `onActivate(-1)` reads past the end of `flatRefs` and no-ops.
  const flatIndex = flatRefs.findIndex(
    (r) =>
      selection &&
      r.kind === selection.kind &&
      (r.kind === "stash"
        ? selection.kind === "stash" && r.index === selection.index
        : selection.kind !== "stash" && r.name === selection.name),
  );
  usePaneList({
    paneId: "branches.list",
    count: flatRefs.length,
    selectedIndex: flatIndex,
    onSelect: (i) => {
      const r = flatRefs[i];
      if (r) setSelection(r);
    },
    onActivate: (i) => {
      const r = flatRefs[i];
      if (r?.kind !== "branch") return;
      const b = branches.find((x) => x.name === r.name);
      if (b && !b.isHead && !b.isRemote) {
        void useRepoStore.getState().checkoutBranch(b.name);
      }
    },
    searchText: (i) => {
      const r = flatRefs[i];
      if (!r) return "";
      return r.kind === "stash" ? `stash@{${r.index}}` : r.name;
    },
  });

  const selectedBranch =
    selection?.kind === "branch"
      ? branches.find((b) => b.name === selection.name) ?? null
      : null;
  const selectedTag =
    selection?.kind === "tag"
      ? tags.find((t) => t.name === selection.name) ?? null
      : null;
  const selectedStash =
    selection?.kind === "stash"
      ? stashes.find((s) => s.index === selection.index) ?? null
      : null;

  const cellStyle: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 8px",
  };

  if (branches.length === 0 && tags.length === 0 && stashes.length === 0) {
    return (
      <>
        <BranchesToolbar
          filter={filter}
          onFilter={setFilter}
          view={view}
          onView={setView}
          onNew={startCreate}
          onFetchAll={fetchAllOp}
          fetching={!!activity.fetch}
        />
        <PGEmpty icon="branch" title="No branches, tags, or stashes">
          This repository doesn&apos;t have any branches, tags, or stashes yet.
        </PGEmpty>
      </>
    );
  }

  return (
    <>
      <BranchesToolbar
        filter={filter}
        onFilter={setFilter}
        view={view}
        onView={setView}
        onNew={startCreate}
        onFetchAll={fetchAllOp}
        fetching={!!activity.fetch}
      />
      <div ref={layout.ref} style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PGPane
          id="branches.list"
          primary
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <FocusableScroll ariaLabel="Refs list" style={{ flex: 1 }}>
          <div style={{ minWidth: totalWidth }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                height: "calc(24px + var(--row-step))",
                background: "var(--bg-2)",
                borderBottom: "1px solid var(--border-0)",
                alignItems: "center",
                position: "sticky",
                top: 0,
                zIndex: 2,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-10)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--fg-2)",
              }}
            >
              {COLS.map((c, i) => (
                <div
                  key={c.key}
                  style={{
                    ...cellStyle,
                    position: "relative",
                    height: "100%",
                  }}
                >
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {c.label}
                  </span>
                  {c.resizable && i < COLS.length - 1 && (
                    <div
                      onMouseDown={(e) => startResize(i, e)}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        right: -3,
                        width: 6,
                        cursor: "col-resize",
                        zIndex: 3,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            {rows.map((b, i) => (
              <div
                key={`${b.kind}:${b.name}`}
                onClick={() => setSelection({ kind: "branch", name: b.name })}
                onContextMenu={(e) => onBranchCtx(e, b)}
                data-pg-row=""
                data-testid="branch-row"
                data-selected={
                  selection?.kind === "branch" && selection.name === b.name
                    ? ""
                    : undefined
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: "calc(28px + var(--row-step))",
                  background:
                    selection?.kind === "branch" && selection.name === b.name
                      ? undefined
                      : i % 2
                        ? "var(--bg-1)"
                        : "transparent",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  position: "relative",
                }}
              >
                {b.isHead && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "var(--accent)",
                      zIndex: 1,
                    }}
                  />
                )}
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIcon
                    name="branch"
                    size={12}
                    style={{
                      color: b.isHead ? "var(--accent)" : "var(--fg-2)",
                    }}
                  />
                </div>
                <div
                  style={{
                    ...cellStyle,
                    color: b.isHead ? "var(--accent)" : "var(--fg-0)",
                  }}
                  title={b.name}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.name}
                  </span>
                  {b.isHead && <PGBadge tone="accent">HEAD</PGBadge>}
                  {b.kind === "remote" && <PGBadge tone="muted">remote</PGBadge>}
                </div>
                <div
                  style={{
                    ...cellStyle,
                    color: "var(--accent)",
                    fontSize: "var(--fs-11)",
                  }}
                >
                  {b.tip ? shortSha(b.tip) : "—"}
                </div>
                <div
                  style={{
                    ...cellStyle,
                    color: "var(--fg-2)",
                    fontSize: "var(--fs-11)",
                  }}
                >
                  {b.upstream ?? "—"}
                </div>
                <div
                  style={{ ...cellStyle, gap: 4, fontSize: "var(--fs-11)" }}
                >
                  {b.ahead > 0 && (
                    <span style={{ color: "var(--git-added)" }}>
                      ↑{b.ahead}
                    </span>
                  )}
                  {b.behind > 0 && (
                    <span style={{ color: "var(--git-modified)" }}>
                      ↓{b.behind}
                    </span>
                  )}
                  {b.ahead === 0 && b.behind === 0 && (
                    <span style={{ color: "var(--fg-3)" }}>
                      {b.upstream ? "up to date" : "no upstream"}
                    </span>
                  )}
                </div>
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIconButton
                    icon="more"
                    size="sm"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      onBranchCtx(e, b);
                    }}
                  />
                </div>
              </div>
            ))}

            {visibleTags.length > 0 && (
              <div
                style={{
                  padding: "16px 12px 6px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-10)",
                  color: "var(--fg-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                TAGS
              </div>
            )}
            {visibleTags.map((t) => (
              <div
                key={t.name}
                onClick={() => setSelection({ kind: "tag", name: t.name })}
                onContextMenu={(e) => onTagCtx(e, t)}
                data-pg-row=""
                data-selected={
                  selection?.kind === "tag" && selection.name === t.name
                    ? ""
                    : undefined
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: "calc(28px + var(--row-step))",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIcon
                    name="tag"
                    size={12}
                    style={{ color: "var(--git-modified)" }}
                  />
                </div>
                <div style={cellStyle} title={t.name}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name}
                  </span>
                </div>
                <div style={{ ...cellStyle, color: "var(--accent)" }}>
                  {t.shortOid}
                </div>
                <div style={{ ...cellStyle, color: "var(--fg-3)" }}>—</div>
                <div style={{ ...cellStyle, color: "var(--fg-3)", gap: 4 }}>
                  {t.signed ? "signed tag" : "tag"}
                  {/* Read off the tag object, so it costs nothing per row and
                      claims no verdict. The graded badge is in the inspector,
                      where exactly one tag is verified at a time (#132). */}
                  {t.signed && (
                    <span
                      data-testid="tag-signed-glyph"
                      title="This tag carries a signature"
                      style={{ display: "inline-flex", color: "var(--fg-2)" }}
                    >
                      <PGIcon name="lock" size={11} />
                    </span>
                  )}
                </div>
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIconButton
                    icon="more"
                    size="sm"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagCtx(e, t);
                    }}
                  />
                </div>
              </div>
            ))}

            {visibleStashes.length > 0 && (
              <div
                style={{
                  padding: "16px 12px 6px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-10)",
                  color: "var(--fg-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                STASHES
              </div>
            )}
            {visibleStashes.map((s) => (
              <div
                key={`stash:${s.index}`}
                data-stash-index={s.index}
                onClick={() => setSelection({ kind: "stash", index: s.index })}
                onContextMenu={(e) => onStashCtx(e, stashTarget(s))}
                data-pg-row=""
                data-selected={
                  selection?.kind === "stash" && selection.index === s.index
                    ? ""
                    : undefined
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: "calc(28px + var(--row-step))",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIcon
                    name="stash"
                    size={12}
                    style={{ color: "var(--fg-2)" }}
                  />
                </div>
                <div style={cellStyle} title={`stash@{${s.index}}`}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    stash@{`{${s.index}}`}
                  </span>
                </div>
                <div style={{ ...cellStyle, color: "var(--accent)" }}>
                  {s.shortOid}
                </div>
                <div
                  style={{
                    ...cellStyle,
                    color: "var(--fg-2)",
                    fontSize: "var(--fs-11)",
                  }}
                  title={s.message}
                >
                  {s.message}
                </div>
                <div style={{ ...cellStyle, color: "var(--fg-3)" }}>stash</div>
                <div
                  style={{ ...cellStyle, justifyContent: "center", padding: 0 }}
                >
                  <PGIconButton
                    icon="more"
                    size="sm"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStashCtx(e, stashTarget(s));
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          </FocusableScroll>
        </PGPane>

        <PGResizeHandle
          onDrag={(d) => inspectorPane.resize(-d)}
          onReset={inspectorPane.reset}
          side="left"
        />
        <PGPane
          id="branches.detail"
          style={{
            width: inspectorPane.size,
            borderLeft: "1px solid var(--border-0)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid var(--border-0)" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-10)",
                color: "var(--fg-2)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              {selection?.kind?.toUpperCase() ?? "REF"}
            </div>
            {selectedBranch && <BranchInspector branch={selectedBranch} />}
            {selectedTag && <TagInspector tag={selectedTag} />}
            {selectedStash && <StashInspector stash={selectedStash} />}
            {!selection && (
              <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-12)" }}>
                Select a branch, tag, or stash to inspect.
              </span>
            )}
          </div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedBranch && <BranchActions branch={selectedBranch} />}
            {selectedTag && <TagActions tag={selectedTag} />}
            {selectedStash && <StashActions stash={selectedStash} />}
          </div>
        </PGPane>
      </div>
      {branchMenu}
      {tagMenu}
      {stashMenu}
    </>
  );
}

function BranchesToolbar({
  filter,
  onFilter,
  view,
  onView,
  onNew,
  onFetchAll,
  fetching,
}: {
  filter: string;
  onFilter: (v: string) => void;
  view: "all" | "local" | "remote" | "tags" | "stashes";
  onView: (v: "all" | "local" | "remote" | "tags" | "stashes") => void;
  onNew: () => void;
  onFetchAll: () => void;
  fetching: boolean;
}) {
  return (
    <PGToolbar
      left={
        <>
          <PGSearchInput
            value={filter}
            onChange={onFilter}
            placeholder="Filter by name…"
            style={{ width: 340 }}
          />
          <PGButtonGroup
            value={view}
            onChange={(v) => onView(v as typeof view)}
            options={[
              { value: "all", label: "All" },
              { value: "local", label: "Local" },
              { value: "remote", label: "Remote" },
              { value: "tags", label: "Tags" },
              { value: "stashes", label: "Stashes" },
            ]}
          />
        </>
      }
      right={
        <>
          <PGButton
            size="sm"
            variant="outline"
            icon="fetch"
            loading={fetching}
            onClick={onFetchAll}
          >
            Fetch all
          </PGButton>
          <PGButton
            size="sm"
            variant="primary"
            icon="plus"
            onClick={onNew}
          >
            New branch
          </PGButton>
        </>
      }
    />
  );
}

function BranchInspector({ branch }: { branch: BranchInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon
          name="branch"
          size={14}
          style={{ color: "var(--accent)", flexShrink: 0 }}
        />
        <span
          title={branch.name}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--accent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {branch.name}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Kind" v={branch.isRemote ? "remote" : "local"} />
        <KV k="Tip" v={<span className="mono">{branch.tip ? shortSha(branch.tip) : "—"}</span>} />
        {!branch.isRemote && (
          <>
            <KV k="Tracks" v={branch.upstream ?? "— (no upstream)"} />
            <KV
              k="Ahead"
              v={
                <span style={{ color: "var(--git-added)" }}>
                  {branch.ahead} commits
                </span>
              }
            />
            <KV
              k="Behind"
              v={
                <span style={{ color: "var(--git-modified)" }}>
                  {branch.behind} commits
                </span>
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function BranchActions({ branch }: { branch: BranchInfo }) {
  return (
    <>
      {!branch.isRemote && (
        <PGButton
          variant="outline"
          icon="link"
          title={`Set or clear the upstream for ${branch.name}`}
          onClick={() => void promptUpstream(branch)}
        >
          Set upstream
        </PGButton>
      )}
      <PGButton
        variant="primary"
        icon="check"
        disabled={branch.isHead}
        onClick={() => useRepoStore.getState().checkoutBranch(branch.name)}
      >
        Check out
      </PGButton>
      <PGButton
        variant="outline"
        icon="merge"
        disabled={branch.isHead}
        title={`Merge ${branch.name} into current branch`}
        onClick={async () => {
          if (
            !(await pgConfirm({
              title: `Merge ${branch.name} into the current branch?`,
              confirmLabel: "Merge",
            }))
          )
            return;
          useRepoStore.getState().mergeBranch(branch.name);
        }}
      >
        Merge into current
      </PGButton>
      <PGButton
        variant="outline"
        icon="rebase"
        disabled={branch.isHead}
        title={`Rebase current branch onto ${branch.name}`}
        onClick={async () => {
          if (
            !(await pgConfirm({
              title: `Rebase the current branch onto ${branch.name}?`,
              body: "Your commits are replayed on top — this rewrites history, so their SHAs change.",
              confirmLabel: "Rebase",
            }))
          )
            return;
          useRepoStore.getState().rebaseOnto(branch.name);
        }}
      >
        Rebase current onto this
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        disabled={branch.isHead}
        onClick={async () => {
          if (
            await pgConfirm({
              title: `Delete branch ${branch.name}?`,
              danger: true,
              confirmLabel: "Delete",
            })
          )
            useRepoStore.getState().deleteBranch(branch.name);
        }}
      >
        Delete branch
      </PGButton>
    </>
  );
}

/**
 * Prompt for a branch's upstream (#61 D9).
 *
 * An empty submitted string clears tracking; a dismissed prompt (null) does
 * nothing. That empty-vs-null distinction is guaranteed by pgPrompt, and is
 * what makes a prompt sufficient here instead of a bespoke picker — so
 * `requireValue` must stay off.
 */
export async function promptUpstream(branch: BranchInfo) {
  const next = await pgPrompt({
    title: `Upstream for ${branch.name}`,
    body: "Remote-tracking branch, e.g. origin/main. Leave empty to clear tracking.",
    initialValue: branch.upstream ?? "",
    placeholder: "origin/main",
    confirmLabel: "Set",
    mono: true,
  });
  if (next === null) return;
  const trimmed = next.trim();
  await useRepoStore
    .getState()
    .setUpstream(branch.name, trimmed === "" ? null : trimmed);
}

function TagInspector({ tag }: { tag: TagInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon name="tag" size={14} style={{ color: "var(--git-modified)", flexShrink: 0 }} />
        <span
          title={tag.name}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--fg-0)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tag.name}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Oid" v={<span className="mono">{tag.shortOid}</span>} />
        {/* Verified lazily, for this one selected tag (#132) — see
            TagSignatureBadge for why it is not on every row. */}
        {tag.signed && (
          <KV k="Signature" v={<TagSignatureBadge name={tag.name} />} />
        )}
      </div>
    </>
  );
}

function TagActions({ tag }: { tag: TagInfo }) {
  const remotes = useRepoStore((s) => s.remotes);
  const defaultRemote = remotes[0]?.name ?? null;
  return (
    <>
      <PGButton
        variant="primary"
        icon="check"
        onClick={() => useRepoStore.getState().checkoutRef(tag.name)}
      >
        Check out (detached)
      </PGButton>
      <PGButton
        variant="outline"
        icon="push"
        disabled={!defaultRemote}
        title={defaultRemote ? `push to ${defaultRemote}` : "no remote configured"}
        onClick={() => {
          if (defaultRemote)
            useRepoStore.getState().pushTag(defaultRemote, tag.name);
        }}
      >
        Push tag{defaultRemote ? ` to ${defaultRemote}` : ""}
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        onClick={async () => {
          if (
            await pgConfirm({
              title: `Delete tag ${tag.name}?`,
              body: "Only the local tag — a tag already pushed stays on the remote.",
              danger: true,
              confirmLabel: "Delete tag",
            })
          )
            useRepoStore.getState().deleteTag(tag.name);
        }}
      >
        Delete tag
      </PGButton>
    </>
  );
}

/**
 * A `StashInfo` as the shared menu addresses it (#133). The full `oid` is what
 * makes the two comparisons safe to issue — see `StashMenuTarget`.
 */
function stashTarget(s: StashInfo): StashMenuTarget {
  return {
    index: s.index,
    name: `stash@{${s.index}}`,
    oid: s.oid,
    message: s.message,
    untracked: s.untracked,
  };
}

function StashInspector({ stash }: { stash: StashInfo }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        <PGIcon name="stash" size={14} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-14)",
            color: "var(--fg-0)",
          }}
        >
          stash@{`{${stash.index}}`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <KV k="Oid" v={<span className="mono">{stash.shortOid}</span>} />
        <KV k="Message" v={stash.message} />
        {stash.untracked && (
          <KV k="Untracked" v="carries files git had no copy of" />
        )}
      </div>
    </>
  );
}

function StashActions({ stash }: { stash: StashInfo }) {
  return (
    <>
      <PGButton
        variant="primary"
        icon="check"
        onClick={() => useRepoStore.getState().stashApply(stash.index)}
      >
        Apply
      </PGButton>
      <PGButton
        variant="outline"
        icon="stash"
        onClick={() => useRepoStore.getState().stashPop(stash.index)}
      >
        Pop
      </PGButton>
      <PGButton
        variant="outline"
        icon="fileCode"
        onClick={() => openStashDiff(stashTarget(stash))}
      >
        Show what it changed
      </PGButton>
      <PGButton
        variant="outline"
        icon="diff"
        onClick={() => openStashVsWorktree(stashTarget(stash))}
      >
        Compare with working tree
      </PGButton>
      <PGButton
        variant="ghost"
        icon="edit"
        onClick={() => promptStashRename(stashTarget(stash))}
      >
        Rename
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        onClick={async () => {
          if (
            await pgConfirm({
              title: `Drop stash@{${stash.index}}?`,
              body: "The stashed changes are discarded.",
              danger: true,
              confirmLabel: "Drop",
            })
          )
            useRepoStore.getState().stashDrop(stash.index, stash.oid);
        }}
      >
        Drop
      </PGButton>
    </>
  );
}
