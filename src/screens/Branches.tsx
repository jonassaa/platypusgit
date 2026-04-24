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
  remoteBranchMenuItems,
  stashMenuItems,
  tagMenuItems,
  useContextMenu,
  usePaneWidth,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import type { BranchInfo, StashInfo, TagInfo } from "@/lib/types";

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

  const startCreate = () => {
    const raw = window.prompt("New branch name");
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
  const { onContextMenu: onStashCtx, menu: stashMenu } = useContextMenu<{
    index: number;
    name: string;
  }>((s) => stashMenuItems(s));

  const [widths, setWidths] = React.useState(() => COLS.map((c) => c.initial));
  const gridTemplate = widths.map((w) => `${w}px`).join(" ");
  const inspectorPane = usePaneWidth(320, {
    min: 220,
    max: 560,
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
    const filtered = list.filter((b) => b.name.includes(filter));
    if (view === "local") return filtered.filter((b) => b.kind === "local");
    if (view === "remote") return filtered.filter((b) => b.kind === "remote");
    return filtered;
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
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <div style={{ minWidth: totalWidth }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                height: 24,
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
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  background:
                    selection?.kind === "branch" && selection.name === b.name
                      ? "var(--bg-selection)"
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
                  {b.tip ?? "—"}
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
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                  cursor: "pointer",
                  background:
                    selection?.kind === "tag" && selection.name === t.name
                      ? "var(--bg-selection)"
                      : "transparent",
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
                <div style={{ ...cellStyle, color: "var(--fg-3)" }}>tag</div>
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
                onClick={() => setSelection({ kind: "stash", index: s.index })}
                onContextMenu={(e) =>
                  onStashCtx(e, { index: s.index, name: `stash@{${s.index}}` })
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
                  cursor: "pointer",
                  background:
                    selection?.kind === "stash" && selection.index === s.index
                      ? "var(--bg-selection)"
                      : "transparent",
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
                      onStashCtx(e, {
                        index: s.index,
                        name: `stash@{${s.index}}`,
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <PGResizeHandle
          onDrag={(d) => inspectorPane.resize(-d)}
          side="left"
        />
        <div
          style={{
            width: inspectorPane.width,
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
        </div>
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
        <KV k="Tip" v={<span className="mono">{branch.tip ?? "—"}</span>} />
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
        onClick={() => {
          if (!window.confirm(`Merge ${branch.name} into the current branch?`))
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
        onClick={() => {
          if (
            !window.confirm(
              `Rebase the current branch onto ${branch.name}? This rewrites history.`,
            )
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
        onClick={() => {
          if (window.confirm(`Delete ${branch.name}?`))
            useRepoStore.getState().deleteBranch(branch.name);
        }}
      >
        Delete branch
      </PGButton>
    </>
  );
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
        onClick={() => {
          if (window.confirm(`Delete tag ${tag.name}?`))
            useRepoStore.getState().deleteTag(tag.name);
        }}
      >
        Delete tag
      </PGButton>
    </>
  );
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
      </div>
    </>
  );
}

function StashActions({ stash }: { stash: StashInfo }) {
  const setIntent = useNavStore((s) => s.setIntent);
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
        onClick={() => setIntent({ kind: "stash-diff", oid: stash.shortOid })}
      >
        Show diff
      </PGButton>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="trash"
        onClick={() => {
          if (window.confirm(`Drop stash@{${stash.index}}?`))
            useRepoStore.getState().stashDrop(stash.index);
        }}
      >
        Drop
      </PGButton>
    </>
  );
}
