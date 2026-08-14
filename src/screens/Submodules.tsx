// Submodules screen (#93).
//
// Before this, a repository with submodules said nothing about them: `status`
// reported the gitlink and every other surface treated it as a directory it could
// not diff, blame or explain. This is where that stops.

import React from "react";
import {
  PGBadge,
  PGButton,
  PGCheckbox,
  PGEmpty,
  PGSectionHeader,
  PGSubmoduleRow,
  submoduleMenuItems,
  useContextMenu,
} from "@/design";
import { FocusableScroll, PGPane, usePaneList } from "@/features/keymap";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSubmodulesStore } from "@/features/submodules/useSubmodulesStore";
import { appErrorMessage } from "@/lib/errors";
import type { SubmoduleInfo } from "@/lib/types";

const PANE_ID = "submodules.list";

export function SubmodulesScreen() {
  const repo = useRepoStore((s) => s.current);
  const items = useSubmodulesStore((s) => s.items);
  const loading = useSubmodulesStore((s) => s.loading);
  const error = useSubmodulesStore((s) => s.error);
  const busy = useSubmodulesStore((s) => s.busy);
  const recursive = useSubmodulesStore((s) => s.recursive);
  const refresh = useSubmodulesStore((s) => s.refresh);

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
      const sm = items[i];
      if (sm && sm.state !== "Uninitialized") {
        void useSubmodulesStore.getState().openAsRepo(sm.path);
      }
    },
    searchText: (i) => items[i]?.path ?? "",
  });

  const { onContextMenu, menu } = useContextMenu<SubmoduleInfo>((sm) =>
    submoduleMenuItems(sm),
  );

  const uninitialized = items.filter((s) => s.state === "Uninitialized").length;
  const store = useSubmodulesStore.getState();

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <PGPane
        id={PANE_ID}
        primary
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <FocusableScroll
          ariaLabel="Submodules"
          testId="submodules-list"
          style={{ flex: 1, minHeight: 0, padding: 16 }}
        >
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <PGSectionHeader
              actions={
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* Persisted, because a repo with nested submodules wants it
                      every single time. */}
                  <PGCheckbox
                    checked={recursive}
                    onChange={(v) => store.setRecursive(v)}
                    label="recursive"
                    testId="submodules-recursive"
                  />
                  {uninitialized > 0 && (
                    <PGButton
                      size="xs"
                      variant="ghost"
                      icon="download"
                      data-testid="submodules-init-all"
                      onClick={() => void store.init()}
                    >
                      Init all
                    </PGButton>
                  )}
                  <PGButton
                    size="xs"
                    variant="ghost"
                    icon="sync"
                    data-testid="submodules-update-all"
                    onClick={() => void store.update()}
                    loading={busy === "*"}
                  >
                    Update all
                  </PGButton>
                  <PGButton
                    size="xs"
                    variant="ghost"
                    icon="link"
                    data-testid="submodules-sync-all"
                    onClick={() => void store.sync()}
                  >
                    Sync URLs
                  </PGButton>
                </div>
              }
            >
              SUBMODULES ({items.length})
              {uninitialized > 0 && (
                <span style={{ marginLeft: 8 }}>
                  <PGBadge tone="warn">{uninitialized} not initialized</PGBadge>
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
              <PGEmpty icon="submodule" title="No submodules">
                This repository declares no submodules. Add one with{" "}
                <span className="mono">git submodule add</span>, then refresh.
              </PGEmpty>
            )}

            {items.map((sm, i) => (
              <div
                key={sm.path}
                data-pg-row=""
                data-selected={i === selected ? "" : undefined}
                onClick={() => setSelected(i)}
              >
                <PGSubmoduleRow
                  submodule={sm}
                  busy={busy === sm.path}
                  onContextMenu={(e) => onContextMenu(e, sm)}
                  onInit={() => void store.init(sm.path)}
                  onUpdate={() => void store.update(sm.path)}
                  onOpen={() => void store.openAsRepo(sm.path)}
                />
              </div>
            ))}
          </div>
        </FocusableScroll>
      </PGPane>
      {menu}
    </div>
  );
}
