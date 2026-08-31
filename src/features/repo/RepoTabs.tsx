// The open-repository strip's wiring (#90): `useTabsStore` → `PGTabStrip`.
//
// Rendered by AppShell below the titlebar, only while at least one repository is
// open, so the Welcome screen is untouched.

import React from "react";

import {
  PGTabStrip,
  pgConfirm,
  pgFlash,
  useContextMenu,
  type ContextMenuItem,
  type PGTabItem,
} from "@/design";
import { useRowReorder } from "@/features/dnd";
import { chordFor } from "@/features/keymap/chordFor";
import { openRepoDialog } from "./ops";
import { labelTabs } from "./tabs";
import { useTabsStore } from "./useTabsStore";
import { fileManagerLabel, usePlatform, type Platform } from "@/lib/platform";
import { openInTerminal, revealInFileManager } from "@/lib/tauri";

export function RepoTabs() {
  const tabs = useTabsStore((s) => s.tabs);
  const activePath = useTabsStore((s) => s.activePath);
  const refreshBadges = useTabsStore((s) => s.refreshBadges);
  // Memoized, not a store selector: `labelTabs` builds a fresh array, which as
  // a selector result would fail zustand's identity check and re-render the
  // strip on every unrelated store write.
  const labels = React.useMemo(() => labelTabs(tabs), [tabs]);

  // Badges for INACTIVE tabs are frozen at the moment their tab was left. One
  // `get_status` each on window focus is what makes them honest again after you
  // commit in an editor and alt-tab back — cheap, and no background polling.
  React.useEffect(() => {
    const onFocus = () => {
      void refreshBadges();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBadges]);

  const items: PGTabItem[] = tabs.map((t, i) => ({
    id: t.path,
    label: labels[i] ?? t.path,
    title: t.path,
    active: t.path === activePath,
    dirty: t.dirty,
    conflicts: t.conflicts,
    failed: t.status === "failed",
  }));

  // Drag to reorder (#238). Keys are the tab paths — the strip's identity — so
  // the hook's FLIP signature changes exactly when the order does.
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const paths = React.useMemo(() => tabs.map((t) => t.path), [tabs]);
  const { registerRow, onRowPointerDown, draggingKey } = useRowReorder(
    paths,
    (from, to) => useTabsStore.getState().reorder(from, to),
    stripRef,
    "x",
  );

  const platform = usePlatform();
  const menu = useContextMenu<string>((path) =>
    tabMenuItems(path, tabs.length, platform),
  );

  if (tabs.length === 0) return null;

  return (
    <>
      <PGTabStrip
        tabs={items}
        onSelect={(id) => void useTabsStore.getState().activate(id)}
        onClose={(id) => void useTabsStore.getState().close(id)}
        onNew={() => void openRepoDialog()}
        onTabContextMenu={(id, e) => menu.onContextMenu(e, id)}
        reorder={{
          registerTab: registerRow,
          onTabPointerDown: onRowPointerDown,
          draggingId: draggingKey,
          scrollRef: stripRef,
        }}
      />
      {menu.menu}
    </>
  );
}

/**
 * Closing ONE tab is never confirmed — it closes a view, and nothing on disk is
 * lost by it, so a prompt there would misrepresent the stakes. The bulk verbs
 * are confirmed, because "close six of these" is not undoable.
 */
export function tabMenuItems(
  path: string,
  total: number,
  platform?: Platform,
): ContextMenuItem[] {
  const tabs = () => useTabsStore.getState();
  // Only an OPENED tab has a repoId — a still-loading or failed tab has
  // nothing on the backend to resolve a directory from, so reveal/terminal
  // stay disabled rather than firing at a repo that isn't there.
  const repoId = tabs().tabs.find((t) => t.path === path)?.repoId;
  // The drag's visible equivalent (#238), the way the rebase plan pairs its
  // drag with chevrons. Indices are read at click time, not menu-build time.
  const move = (delta: 1 | -1) => () => {
    const from = tabs().tabs.findIndex((t) => t.path === path);
    if (from >= 0) tabs().reorder(from, from + delta);
  };
  const index = tabs().tabs.findIndex((t) => t.path === path);
  return [
    { __menuTitle: "Repository" },
    {
      label: "Move left",
      icon: "chevronLeft",
      shortcut: chordFor("tab.moveLeft"),
      disabled: index <= 0,
      onClick: move(-1),
    },
    {
      label: "Move right",
      icon: "chevronRight",
      shortcut: chordFor("tab.moveRight"),
      disabled: index < 0 || index >= total - 1,
      onClick: move(1),
    },
    { divider: true },
    {
      label: "Close",
      icon: "x",
      onClick: () => void tabs().close(path),
    },
    {
      label: "Close others",
      icon: "trash",
      disabled: total < 2,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Close ${total - 1} other repositor${total - 1 === 1 ? "y" : "ies"}?`,
            body: "Only closes the tabs — nothing on disk changes.",
            confirmLabel: "Close others",
          })
        ) {
          await tabs().closeOthers(path);
        }
      },
    },
    {
      label: "Close all",
      icon: "trash",
      danger: true,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Close all ${total} repositor${total === 1 ? "y" : "ies"}?`,
            body: "Only closes the tabs — nothing on disk changes.",
            danger: true,
            confirmLabel: "Close all",
          })
        ) {
          await tabs().closeAll();
        }
      },
    },
    { divider: true },
    {
      label: "Copy path",
      icon: "copy",
      onClick: () => {
        void navigator.clipboard
          ?.writeText(path)
          .then(() => pgFlash("Path copied"))
          .catch(() => pgFlash("Could not copy path"));
      },
    },
    {
      label: fileManagerLabel(platform),
      icon: "folder",
      disabled: !repoId,
      onClick: () => {
        if (!repoId) return;
        void revealInFileManager(repoId).catch(() =>
          pgFlash("Could not reveal in file manager"),
        );
      },
    },
    {
      label: "Open in terminal",
      icon: "terminal",
      disabled: !repoId,
      onClick: () => {
        if (!repoId) return;
        void openInTerminal(repoId).catch(() =>
          pgFlash("Could not open terminal"),
        );
      },
    },
  ];
}
