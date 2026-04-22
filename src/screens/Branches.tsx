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
  tagMenuItems,
  useContextMenu,
  usePaneWidth,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo, TagInfo } from "@/lib/types";

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
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [view, setView] = React.useState<"all" | "local" | "remote" | "tags">(
    "all",
  );

  const { onContextMenu: onBranchCtx, menu: branchMenu } = useContextMenu<
    BranchInfo & { kind: "local" | "remote" }
  >((b) =>
    b?.kind === "remote"
      ? remoteBranchMenuItems({ name: b.name })
      : branchMenuItems({ name: b?.name, current: b?.isHead }),
  );
  const { onContextMenu: onTagCtx, menu: tagMenu } = useContextMenu<TagInfo>(
    (t) => tagMenuItems({ name: t?.name, sha: t?.shortOid }),
  );

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
    if (view === "tags" || view === "all")
      return tags.filter((t) => t.name.includes(filter));
    return [];
  }, [tags, filter, view]);

  const selectedBranch = branches.find((b) => b.name === selected) ?? null;

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

  if (branches.length === 0 && tags.length === 0) {
    return (
      <>
        <BranchesToolbar
          filter={filter}
          onFilter={setFilter}
          view={view}
          onView={setView}
        />
        <PGEmpty icon="branch" title="No branches or tags">
          This repository doesn&apos;t have any branches yet.
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
                onClick={() => setSelected(b.name)}
                onContextMenu={(e) => onBranchCtx(e, b)}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  background:
                    selected === b.name
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
                  <PGIconButton icon="more" size="sm" />
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
                onContextMenu={(e) => onTagCtx(e, t)}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  alignItems: "center",
                  height: 28,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  borderBottom: "1px solid oklch(0.22 0.008 260 / 0.3)",
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
                  <PGIconButton icon="more" size="sm" />
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
          <div
            style={{
              padding: 12,
              borderBottom: "1px solid var(--border-0)",
            }}
          >
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
              BRANCH
            </div>
            {selectedBranch ? (
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
                    title={selectedBranch.name}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-14)",
                      color: "var(--accent)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedBranch.name}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <KV
                    k="Kind"
                    v={selectedBranch.isRemote ? "remote" : "local"}
                  />
                  <KV
                    k="Tip"
                    v={<span className="mono">{selectedBranch.tip ?? "—"}</span>}
                  />
                  {!selectedBranch.isRemote && (
                    <>
                      <KV
                        k="Tracks"
                        v={selectedBranch.upstream ?? "— (no upstream)"}
                      />
                      <KV
                        k="Ahead"
                        v={
                          <span style={{ color: "var(--git-added)" }}>
                            {selectedBranch.ahead} commits
                          </span>
                        }
                      />
                      <KV
                        k="Behind"
                        v={
                          <span style={{ color: "var(--git-modified)" }}>
                            {selectedBranch.behind} commits
                          </span>
                        }
                      />
                    </>
                  )}
                </div>
              </>
            ) : (
              <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-12)" }}>
                Select a branch to inspect.
              </span>
            )}
          </div>
          <div
            style={{
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <PGButton
              variant="primary"
              icon="check"
              disabled={!selectedBranch || selectedBranch.isHead}
              onClick={() =>
                selectedBranch &&
                useRepoStore.getState().checkoutBranch(selectedBranch.name)
              }
            >
              Check out
            </PGButton>
            <PGButton
              variant="outline"
              icon="merge"
              disabled={!selectedBranch || selectedBranch.isHead}
              title="merge will land in Plan C"
            >
              Merge into current
            </PGButton>
            <PGButton
              variant="outline"
              icon="rebase"
              disabled={!selectedBranch || selectedBranch.isHead}
              title="rebase will land in Plan E"
            >
              Rebase current onto this
            </PGButton>
            <PGButton
              variant="ghost"
              tone="danger"
              icon="trash"
              disabled={!selectedBranch || selectedBranch.isHead}
              onClick={() => {
                if (!selectedBranch) return;
                if (window.confirm(`Delete ${selectedBranch.name}?`))
                  useRepoStore.getState().deleteBranch(selectedBranch.name);
              }}
            >
              Delete branch
            </PGButton>
          </div>
        </div>
      </div>
      {branchMenu}
      {tagMenu}
    </>
  );
}

function BranchesToolbar({
  filter,
  onFilter,
  view,
  onView,
}: {
  filter: string;
  onFilter: (v: string) => void;
  view: "all" | "local" | "remote" | "tags";
  onView: (v: "all" | "local" | "remote" | "tags") => void;
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
            ]}
          />
        </>
      }
      right={
        <>
          <PGButton size="sm" variant="outline" icon="fetch" disabled>
            Fetch all
          </PGButton>
          <PGButton
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => {
              const name = window.prompt("New branch name");
              if (name) useRepoStore.getState().createBranch(name);
            }}
          >
            New branch
          </PGButton>
        </>
      }
    />
  );
}

