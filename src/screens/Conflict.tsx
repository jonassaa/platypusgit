import React from "react";
import {
  PGBadge,
  PGButton,
  PGConflictRow,
  PGEmpty,
  PGIcon,
  PGProgressBar,
  PGResizeHandle,
  PGSectionHeader,
  PGSpinner,
  conflictMenuItems,
  useContextMenu,
  usePaneWidth,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch } from "@/lib/derive";
import { conflictSides } from "@/lib/tauri";
import type { ConflictSides, RepoState } from "@/lib/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function repoStateLabel(state: RepoState): string | null {
  switch (state) {
    case "Merge":
      return "Merging in progress";
    case "Revert":
    case "RevertSequence":
      return "Revert in progress";
    case "CherryPick":
    case "CherryPickSequence":
      return "Cherry-pick in progress";
    case "Rebase":
    case "RebaseInteractive":
    case "RebaseMerge":
      return "Rebase in progress";
    default:
      return null;
  }
}

// ─── SideColumn ─────────────────────────────────────────────────────────────

function SideColumn({
  label,
  color,
  content,
  loading,
}: {
  label: string;
  color: string;
  content: string | null;
  loading: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-10)",
          color,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          borderBottom: "1px solid var(--border-0)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          whiteSpace: "pre",
          lineHeight: "var(--lh-code)",
        }}
      >
        {loading ? (
          <PGSpinner size={14} />
        ) : content != null ? (
          content
        ) : (
          <span style={{ color: "var(--fg-3)" }}>(no content)</span>
        )}
      </div>
    </div>
  );
}

// ─── ConflictHeader ─────────────────────────────────────────────────────────

function ConflictHeader({
  message,
  dim,
  repoState,
  unresolved,
}: {
  message: string;
  dim?: boolean;
  repoState: RepoState;
  unresolved: number;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          background: "oklch(0.72 0.15 325 / 0.18)",
          border: "1px solid var(--git-conflict)",
          borderRadius: "var(--r-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--git-conflict)",
        }}
      >
        <PGIcon name="conflict" size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--fg-2)",
            marginBottom: 2,
          }}
        >
          {repoStateLabel(repoState) ?? "No operation in progress"}
        </div>
        <div style={{ fontSize: "var(--fs-15)", fontWeight: 600 }}>
          {message}
        </div>
      </div>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="x"
        disabled={repoState === "Clean"}
        data-testid="conflict-abort"
        onClick={() => {
          if (
            window.confirm(
              "Abort the current operation? The working tree will be reset to HEAD.",
            )
          )
            useRepoStore.getState().abortOperation();
        }}
      >
        Abort
      </PGButton>
      <PGButton
        variant="primary"
        icon="merge"
        disabled={unresolved > 0 || repoState === "Clean"}
        data-testid="conflict-finalize"
        onClick={() => useRepoStore.getState().continueOperation()}
      >
        Finalize
      </PGButton>
    </div>
  );
}

// ─── ConflictDetail ─────────────────────────────────────────────────────────

function ConflictDetail({ path }: { path: string }) {
  const repoId = useRepoStore((s) => s.current?.id);
  const acceptOurs = useRepoStore((s) => s.acceptOurs);
  const acceptTheirs = useRepoStore((s) => s.acceptTheirs);
  const markResolved = useRepoStore((s) => s.markResolved);

  const [sides, setSides] = React.useState<ConflictSides | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!repoId || !path) return;
    setLoading(true);
    setSides(null);
    conflictSides(repoId, path)
      .then(setSides)
      .catch(() => setSides(null))
      .finally(() => setLoading(false));
  }, [repoId, path]);

  if (!repoId) return null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* path header */}
      <div
        style={{
          padding: "6px 12px",
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border-0)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          color: "var(--fg-1)",
        }}
      >
        {path}
      </div>

      {sides?.binary ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "var(--fg-2)",
          }}
        >
          <PGIcon name="file" size={32} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)" }}>
            Binary file — cannot show 3-way diff
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <PGButton
              size="sm"
              variant="outline"
              icon="chevronLeft"
              onClick={() => acceptOurs(path)}
            >
              Accept ours
            </PGButton>
            <PGButton
              size="sm"
              variant="outline"
              icon="chevronRight"
              onClick={() => acceptTheirs(path)}
            >
              Accept theirs
            </PGButton>
          </div>
        </div>
      ) : (
        <>
          {/* 3-column diff */}
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <SideColumn
              label="OURS"
              color="var(--accent)"
              content={sides?.ours ?? null}
              loading={loading}
            />
            <div style={{ width: 1, background: "var(--border-0)" }} />
            <SideColumn
              label="BASE"
              color="var(--fg-2)"
              content={sides?.base ?? null}
              loading={loading}
            />
            <div style={{ width: 1, background: "var(--border-0)" }} />
            <SideColumn
              label="THEIRS"
              color="var(--accent-2, var(--fg-1))"
              content={sides?.theirs ?? null}
              loading={loading}
            />
          </div>

          {/* action bar */}
          <div
            style={{
              height: 40,
              borderTop: "2px solid var(--accent)",
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
              gap: 8,
              background: "var(--bg-1)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-2)",
              }}
            >
              RESOLVE:
            </span>
            <PGButton
              size="sm"
              variant="outline"
              icon="chevronLeft"
              data-testid="accept-ours"
              onClick={() => acceptOurs(path)}
            >
              Accept ours
            </PGButton>
            <PGButton
              size="sm"
              variant="outline"
              icon="chevronRight"
              data-testid="accept-theirs"
              onClick={() => acceptTheirs(path)}
            >
              Accept theirs
            </PGButton>
            <PGButton
              size="sm"
              variant="primary"
              icon="check"
              data-testid="mark-resolved"
              onClick={() => markResolved([path])}
            >
              Mark worktree as resolved
            </PGButton>
            {sides?.binary && <PGBadge tone="warn">BINARY</PGBadge>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ConflictScreen ─────────────────────────────────────────────────────────

export function ConflictScreen() {
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
  const repoState = useRepoStore((s) => s.repoState);
  const acceptOurs = useRepoStore((s) => s.acceptOurs);
  const acceptTheirs = useRepoStore((s) => s.acceptTheirs);
  const head = currentBranch(branches);

  const conflicts = React.useMemo(
    () =>
      status.filter(
        (s) =>
          s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted",
      ),
    [status],
  );

  const [selected, setSelected] = React.useState(0);
  const listPane = usePaneWidth(340, {
    min: 220,
    max: 600,
    storageKey: "pg-conflict-list-w",
  });
  const { onContextMenu: onConflictCtx, menu: conflictMenu } =
    useContextMenu<{ path: string }>(conflictMenuItems);

  // Reset selection when conflict list changes
  React.useEffect(() => {
    setSelected((prev) => (prev >= conflicts.length ? 0 : prev));
  }, [conflicts.length]);

  if (conflicts.length === 0) {
    return (
      <>
        <ConflictHeader
          message="No merge in progress"
          dim
          repoState={repoState}
          unresolved={0}
        />
        <PGEmpty icon="conflict" title="No conflicts">
          When a merge or rebase runs into conflicts, they&apos;ll show up
          here.
        </PGEmpty>
      </>
    );
  }

  const unresolved = conflicts.length;
  const resolved = 0;
  const selectedConflict = conflicts[selected];

  return (
    <>
      <ConflictHeader
        message={`${unresolved} conflict${unresolved !== 1 ? "s" : ""} remaining on ${head?.name ?? "(detached)"}`}
        repoState={repoState}
        unresolved={unresolved}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: listPane.width,
            flexShrink: 0,
            background: "var(--bg-1)",
            borderRight: "1px solid var(--border-0)",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <PGSectionHeader>
            CONFLICTING FILES ({conflicts.length})
          </PGSectionHeader>
          <div
            style={{
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflow: "auto",
              flex: 1,
            }}
          >
            {conflicts.map((c, i) => (
              <PGConflictRow
                key={c.path}
                path={c.path}
                ours="ours"
                theirs="theirs"
                resolved={false}
                hunkCount={1}
                additions={0}
                deletions={0}
                selected={selected === i}
                onClick={() => setSelected(i)}
                onContextMenu={(e) => onConflictCtx(e, { path: c.path })}
                onPickOurs={() => acceptOurs(c.path)}
                onPickTheirs={() => acceptTheirs(c.path)}
                onEdit={() => {
                  if (c.path) useRepoStore.getState().openInEditor(c.path);
                }}
              />
            ))}
          </div>
          <PGProgressBar
            value={(resolved / Math.max(1, conflicts.length)) * 100}
            tone="success"
            height={2}
            style={{ borderRadius: 0 }}
          />
        </div>
        <PGResizeHandle onDrag={listPane.resize} />

        {selectedConflict ? (
          <ConflictDetail path={selectedConflict.path} />
        ) : (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <PGEmpty icon="merge" title="Select a conflict">
              Pick a file from the list to view the 3-way diff.
            </PGEmpty>
          </div>
        )}
      </div>
      {conflictMenu}
    </>
  );
}
