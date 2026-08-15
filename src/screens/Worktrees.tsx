// Linked worktrees screen (#93).
//
// Mildly overdue: this project's own development workflow is one worktree per
// session, and the app could not see them at all.

import React from "react";
import {
  PGBadge,
  PGButton,
  PGEmpty,
  PGSectionHeader,
  PGWorktreeRow,
  useContextMenu,
  worktreeMenuItems,
} from "@/design";
import { FocusableScroll, PGPane, usePaneList } from "@/features/keymap";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { WorktreeAddDialog } from "@/features/worktrees/WorktreeAddDialog";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { appErrorMessage } from "@/lib/errors";
import type { WorktreeInfo } from "@/lib/types";

const PANE_ID = "worktrees.list";

export function WorktreesScreen() {
  const repo = useRepoStore((s) => s.current);
  const items = useWorktreesStore((s) => s.items);
  const loading = useWorktreesStore((s) => s.loading);
  const error = useWorktreesStore((s) => s.error);
  const busy = useWorktreesStore((s) => s.busy);
  const refresh = useWorktreesStore((s) => s.refresh);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    void refresh();
  }, [repo, refresh]);

  const [selected, setSelected] = React.useState(0);
  usePaneList({
    paneId: PANE_ID,
    count: items.length,
    selectedIndex: selected,
    onSelect: setSelected,
    onActivate: (i) => {
      const wt = items[i];
      // A prunable worktree has no directory left to open.
      if (wt && !wt.prunable && !wt.isCurrent) {
        void useWorktreesStore.getState().openAsRepo(wt.path);
      }
    },
    searchText: (i) => `${items[i]?.name ?? ""} ${items[i]?.branch ?? ""}`,
  });

  const { onContextMenu, menu } = useContextMenu<WorktreeInfo>((wt) =>
    worktreeMenuItems(wt),
  );

  const store = useWorktreesStore.getState();
  const prunable = items.filter((w) => w.prunable).length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <PGPane
        id={PANE_ID}
        primary
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <FocusableScroll
          ariaLabel="Linked worktrees"
          testId="worktrees-list"
          style={{ flex: 1, minHeight: 0, padding: 16 }}
        >
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <PGSectionHeader
              actions={
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {prunable > 0 && (
                    <PGButton
                      size="xs"
                      variant="ghost"
                      icon="trash"
                      data-testid="worktrees-prune"
                      onClick={() => void store.prune()}
                      loading={busy === "*"}
                    >
                      Prune {prunable}
                    </PGButton>
                  )}
                  <PGButton
                    size="xs"
                    variant="ghost"
                    icon="plus"
                    data-testid="worktrees-add"
                    onClick={() => setAdding(true)}
                  >
                    Add worktree
                  </PGButton>
                </div>
              }
            >
              LINKED WORKTREES ({items.length})
              {prunable > 0 && (
                <span style={{ marginLeft: 8 }}>
                  <PGBadge tone="danger">{prunable} missing</PGBadge>
                </span>
              )}
            </PGSectionHeader>

            {error && (
              <div
                role="alert"
                style={{
                  margin: "6px 0",
                  fontSize: "var(--fs-11)",
                  color: "var(--git-removed)",
                }}
              >
                {appErrorMessage(error)}
              </div>
            )}

            {items.length === 0 && !loading && (
              <PGEmpty
                icon="worktree"
                title="No linked worktrees"
                action={
                  <PGButton
                    size="sm"
                    variant="primary"
                    icon="plus"
                    onClick={() => setAdding(true)}
                  >
                    Add worktree
                  </PGButton>
                }
              >
                A linked worktree is a second checkout of this repository, on its own
                branch, in its own directory — so you can work on two branches
                without stashing.
              </PGEmpty>
            )}

            {items.map((wt, i) => (
              <div
                key={wt.name}
                data-pg-row=""
                data-selected={i === selected ? "" : undefined}
                onClick={() => setSelected(i)}
              >
                <PGWorktreeRow
                  worktree={wt}
                  busy={busy === wt.name}
                  onContextMenu={(e) => onContextMenu(e, wt)}
                  onOpen={() => void store.openAsRepo(wt.path)}
                  onRemove={() => void store.remove(wt.name)}
                  onToggleLock={() => void store.toggleLock(wt)}
                />
              </div>
            ))}
          </div>
        </FocusableScroll>
      </PGPane>
      {adding && <WorktreeAddDialog onClose={() => setAdding(false)} />}
      {menu}
    </div>
  );
}
