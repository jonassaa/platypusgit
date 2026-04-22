import React from "react";
import {
  PGButton,
  PGConflictRow,
  PGEmpty,
  PGIcon,
  PGProgressBar,
  PGSectionHeader,
  conflictMenuItems,
  pgFlash,
  useContextMenu,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch } from "@/lib/derive";

export function ConflictScreen() {
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
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
  const { onContextMenu: onConflictCtx, menu: conflictMenu } =
    useContextMenu<{ path: string }>(conflictMenuItems);

  if (conflicts.length === 0) {
    return (
      <>
        <ConflictHeader message="No merge in progress" dim />
        <PGEmpty icon="conflict" title="No conflicts">
          When a merge or rebase runs into conflicts, they&apos;ll show up
          here.
        </PGEmpty>
      </>
    );
  }

  const unresolved = conflicts.length;
  const resolved = 0;

  return (
    <>
      <ConflictHeader
        message={`${unresolved} conflict${unresolved !== 1 ? "s" : ""} remaining on ${head?.name ?? "(detached)"}`}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: 340,
            background: "var(--bg-1)",
            borderRight: "1px solid var(--border-0)",
            display: "flex",
            flexDirection: "column",
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
                onPickOurs={() => pgFlash("accept ours is not wired up yet")}
                onPickTheirs={() =>
                  pgFlash("accept theirs is not wired up yet")
                }
                onEdit={() => pgFlash("open editor is not wired up yet")}
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

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <PGEmpty icon="merge" title="3-way merge view — not implemented">
            A full three-way merge view is coming. In the meantime, resolve
            conflicts in your editor; this pane will update when the repo is
            refreshed.
          </PGEmpty>
        </div>
      </div>
      {conflictMenu}
    </>
  );
}

function ConflictHeader({
  message,
  dim,
}: {
  message: string;
  dim?: boolean;
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
        <div style={{ fontSize: "var(--fs-15)", fontWeight: 600 }}>
          {message}
        </div>
      </div>
      <PGButton
        variant="ghost"
        tone="danger"
        icon="x"
        disabled
        onClick={() => {}}
      >
        Abort merge
      </PGButton>
      <PGButton variant="primary" icon="merge" disabled onClick={() => {}}>
        Finalize merge
      </PGButton>
    </div>
  );
}
