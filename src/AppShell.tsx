import { open } from "@tauri-apps/plugin-dialog";
import React from "react";
import {
  PGActivityBar,
  PGButton,
  PGIconButton,
  PGPrimarySidebar,
  PGResizeHandle,
  PGSearchInput,
  PGSidebarGroup,
  PGSidebarRow,
  PGStatusBar,
  PGStatusItem,
  PGTitlebar,
  pgFlash,
  stashMenuItems,
  useContextMenu,
  usePaneWidth,
  usePreventBrowserContextMenu,
  type ActivityBarItem,
} from "@/design";

import { RepoBrowserScreen } from "@/screens/RepoBrowser";
import { CommitPanelScreen } from "@/screens/CommitPanel";
import { HistoryScreen } from "@/screens/History";
import { DiffViewerScreen } from "@/screens/DiffViewer";
import { BranchesScreen } from "@/screens/Branches";
import { ConflictScreen } from "@/screens/Conflict";
import { RebaseScreen } from "@/screens/Rebase";
import { RemoteScreen } from "@/screens/Remote";
import { WelcomeScreen } from "@/screens/Welcome";
import { ReflogScreen } from "@/screens/Reflog";
import { CommitDiffScreen } from "@/screens/CommitDiff";
import { FileHistoryScreen } from "@/screens/FileHistory";
import { BlameScreen } from "@/screens/Blame";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { appErrorMessage } from "@/lib/errors";
import {
  currentBranch,
  isStaged,
  isUnstaged,
  totalAheadBehind,
} from "@/lib/derive";

/** Derive the [remote, branch] pair from the HEAD branch's upstream tracking ref. */
function headUpstream(
  upstream: string | null | undefined,
  headName: string | undefined,
): [string, string] | null {
  if (!upstream) return null;
  const idx = upstream.indexOf("/");
  if (idx < 0) return [upstream, headName ?? upstream];
  return [upstream.slice(0, idx), upstream.slice(idx + 1)];
}

type ScreenId =
  | "repo"
  | "commit"
  | "history"
  | "branches"
  | "conflict"
  | "rebase"
  | "remote"
  | "diff"
  | "reflog"
  | "commitDiff"
  | "fileHistory"
  | "blame";

const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "repo", icon: "folder", label: "Files", shortcut: "⌘1" },
  {
    id: "commit",
    icon: "commit",
    label: "Commit",
    shortcut: "⌘2",
    badge: true,
  },
  { id: "history", icon: "history", label: "History", shortcut: "⌘3" },
  { id: "branches", icon: "branch", label: "Branches", shortcut: "⌘4" },
  { id: "conflict", icon: "conflict", label: "Conflicts", shortcut: "⌘5" },
  { id: "rebase", icon: "rebase", label: "Rebase", shortcut: "⌘6" },
  { id: "remote", icon: "link", label: "Remotes", shortcut: "⌘7" },
  { id: "diff", icon: "fileCode", label: "Diff viewer", shortcut: "⌘8" },
  { id: "reflog", icon: "clock", label: "Reflog", shortcut: "⌘9" },
];

export function AppShell() {
  usePreventBrowserContextMenu();
  const repo = useRepoStore((s) => s.current);
  const error = useRepoStore((s) => s.error);
  const clearError = useRepoStore((s) => s.clearError);

  const [screen, setScreen] = React.useState<ScreenId>(() => {
    const saved = localStorage.getItem("pg-screen");
    return (saved as ScreenId) || "repo";
  });

  React.useEffect(() => {
    localStorage.setItem("pg-screen", screen);
  }, [screen]);

  React.useEffect(() => {
    if (!repo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (!Number.isFinite(n) || n < 1 || n > ACTIVITY_ITEMS.length) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setScreen(ACTIVITY_ITEMS[n - 1].id as ScreenId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [repo]);

  const intent = useNavStore((s) => s.intent);
  React.useEffect(() => {
    if (!intent) return;
    switch (intent.kind) {
      case "diff-file":
        setScreen("diff");
        break;
      case "commit-vs-wt":
      case "commit-vs-commit":
        setScreen("commitDiff");
        break;
      case "file-history":
        setScreen("fileHistory");
        break;
      case "blame":
        setScreen("blame");
        break;
    }
  }, [intent]);

  const screens: Record<ScreenId, React.ReactNode> = {
    repo: <RepoBrowserScreen />,
    commit: <CommitPanelScreen />,
    history: <HistoryScreen />,
    diff: <DiffViewerScreen />,
    branches: <BranchesScreen />,
    conflict: <ConflictScreen />,
    rebase: <RebaseScreen />,
    remote: <RemoteScreen />,
    reflog: <ReflogScreen />,
    commitDiff: <CommitDiffScreen />,
    fileHistory: <FileHistoryScreen />,
    blame: <BlameScreen />,
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-0)",
        color: "var(--fg-0)",
        overflow: "hidden",
      }}
    >
      <AppTitlebar />
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 14px",
            fontSize: "var(--fs-12)",
            fontFamily: "var(--font-mono)",
            color: "var(--git-removed)",
            background: "oklch(0.68 0.18 25 / 0.1)",
            borderBottom: "1px solid oklch(0.68 0.18 25 / 0.35)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <strong>{error.kind}:</strong>
          <span style={{ flex: 1 }}>{appErrorMessage(error)}</span>
          <button
            onClick={clearError}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "var(--fs-11)",
            }}
          >
            dismiss
          </button>
        </div>
      )}
      {repo ? (
        <AppBody screen={screen} screens={screens} setScreen={setScreen} />
      ) : (
        <WelcomeScreen />
      )}
      <AppStatusBar />
    </div>
  );
}

function AppBody({
  screen,
  screens,
  setScreen,
}: {
  screen: ScreenId;
  screens: Record<ScreenId, React.ReactNode>;
  setScreen: (s: ScreenId) => void;
}) {
  const sidebar = usePaneWidth(260, {
    min: 180,
    max: 520,
    storageKey: "pg-sidebar-w",
  });
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("pg-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("pg-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // non-fatal
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const [dragging, setDragging] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const leaveTimer = React.useRef<number | null>(null);

  const onHoverEnter = React.useCallback(() => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setHovering(true);
  }, []);
  const onHoverLeave = React.useCallback(() => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovering(false), 150);
  }, []);

  React.useEffect(() => {
    if (!collapsed) setHovering(false);
  }, [collapsed]);

  const HOVER_STRIP_W = 6;
  const dockedWidth = collapsed ? HOVER_STRIP_W : sidebar.width;
  const widthTransition = dragging
    ? "none"
    : "width 220ms cubic-bezier(0.4, 0, 0.2, 1)";
  const overlayVisible = !collapsed || hovering;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <PGActivityBar
        value={screen}
        onChange={(id) => setScreen(id as ScreenId)}
        items={ACTIVITY_ITEMS}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          position: "relative",
        }}
      >
        {/* Docked placeholder: reserves layout space; narrow strip when collapsed */}
        <div
          onMouseEnter={collapsed ? onHoverEnter : undefined}
          onMouseLeave={collapsed ? onHoverLeave : undefined}
          onClick={collapsed ? toggleCollapsed : undefined}
          title={collapsed ? "Expand sidebar (⌘B)" : undefined}
          style={{
            width: dockedWidth,
            flexShrink: 0,
            background: "var(--bg-1)",
            borderRight: "1px solid var(--border-0)",
            transition: widthTransition,
            cursor: collapsed ? "pointer" : "default",
          }}
        />
        {!collapsed && (
          <PGResizeHandle
            onDrag={sidebar.resize}
            onActiveChange={setDragging}
          />
        )}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-0)",
          }}
        >
          {screens[screen]}
        </div>
        {/* Sidebar body. Docked when expanded; floating overlay on hover when collapsed. */}
        <div
          onMouseEnter={collapsed ? onHoverEnter : undefined}
          onMouseLeave={collapsed ? onHoverLeave : undefined}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: sidebar.width,
            display: "flex",
            zIndex: 5,
            transform: overlayVisible ? "translateX(0)" : "translateX(-100%)",
            transition: dragging
              ? "none"
              : "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 220ms ease",
            pointerEvents: overlayVisible ? "auto" : "none",
            boxShadow: collapsed && hovering ? "var(--shadow-3)" : "none",
          }}
        >
          <AppSidebar
            width={sidebar.width}
            onCollapse={toggleCollapsed}
            floating={collapsed && hovering}
          />
        </div>
      </div>
    </div>
  );
}

function AppTitlebar() {
  const repo = useRepoStore((s) => s.current);
  const branches = useRepoStore((s) => s.branches);
  const status = useRepoStore((s) => s.status);
  const refresh = useRepoStore((s) => s.refreshAll);
  const close = useRepoStore((s) => s.closeRepo);
  const openStore = useRepoStore((s) => s.openRepo);
  const store = useRepoStore();

  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const dirty = status.filter(
    (s) => isStaged(s) || isUnstaged(s),
  ).length;
  const repoName = repo?.path.split("/").filter(Boolean).pop() ?? "—";

  const upstream = headUpstream(head?.upstream, head?.name);

  const onOpen = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") await openStore(selected);
  };

  const onFetch = () => {
    store.fetchAll();
  };

  const onPull = () => {
    if (!upstream) {
      pgFlash("No upstream configured for current branch");
      return;
    }
    store.pull(upstream[0], upstream[1]);
  };

  const onPush = () => {
    if (!upstream) {
      pgFlash("No upstream configured — run git push -u origin <branch> first");
      return;
    }
    store.push(upstream[0], upstream[1]);
  };

  return (
    <PGTitlebar
      repoName={repoName}
      branch={head?.name ?? "(detached)"}
      dirty={dirty}
      showTrafficLights={false}
      rightSlot={
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {repo && (
            <>
              <PGButton
                size="sm"
                variant="default"
                icon="sync"
                onClick={() => refresh()}
                title="Refresh"
              >
                Refresh
              </PGButton>
              <PGButton
                size="sm"
                variant="default"
                icon="fetch"
                onClick={onFetch}
              >
                Fetch
              </PGButton>
              <PGButton
                size="sm"
                variant="default"
                icon="pull"
                onClick={onPull}
              >
                Pull{" "}
                {behind > 0 && (
                  <span
                    style={{ color: "var(--git-modified)", marginLeft: 4 }}
                  >
                    ↓{behind}
                  </span>
                )}
              </PGButton>
              <PGButton
                size="sm"
                variant="primary"
                icon="push"
                onClick={onPush}
              >
                Push {ahead > 0 && <span style={{ marginLeft: 4 }}>↑{ahead}</span>}
              </PGButton>
              <div
                style={{
                  width: 1,
                  height: 16,
                  background: "var(--border-1)",
                  margin: "0 4px",
                }}
              />
              <PGButton size="sm" variant="ghost" onClick={close}>
                Close repo
              </PGButton>
            </>
          )}
          {!repo && (
            <PGButton
              size="sm"
              variant="primary"
              icon="folder"
              onClick={onOpen}
            >
              Open…
            </PGButton>
          )}
          <PGIconButton icon="bell" size="md" title="Notifications" />
        </div>
      }
    />
  );
}

function AppSidebar({
  width,
  onCollapse,
  floating = false,
}: {
  width: number;
  onCollapse: () => void;
  floating?: boolean;
}) {
  void floating;
  const [branchFilter, setBranchFilter] = React.useState("");
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);
  const stashes = useRepoStore((s) => s.stashes);
  const remotes = useRepoStore((s) => s.remotes);

  const { onContextMenu: onStashCtx, menu: stashMenu } = useContextMenu<{
    index: number;
    name: string;
  }>((s) => stashMenuItems(s));

  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  return (
    <PGPrimarySidebar width={width}>
      <div
        style={{
          padding: 8,
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PGSearchInput
            value={branchFilter}
            onChange={setBranchFilter}
            placeholder="Filter branches…"
            shortcut="⌘P"
          />
        </div>
        <PGIconButton
          icon="chevronLeft"
          size="sm"
          title="Collapse sidebar (⌘B)"
          onClick={onCollapse}
        />
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <PGSidebarGroup
          title="Local"
          icon="branch"
          count={local.length}
          actions={
            <PGIconButton
              icon="plus"
              size="sm"
              title="New branch"
              onClick={async () => {
                    const name = window.prompt("New branch name");
                    if (!name) return;
                    await useRepoStore.getState().createBranch(name);
                    await useRepoStore.getState().checkoutBranch(name);
                  }}
            />
          }
        >
          {local
            .filter((b) => b.name.includes(branchFilter))
            .map((b) => (
              <PGSidebarRow
                key={b.name}
                icon="branch"
                label={b.name}
                selected={b.isHead}
                accent={b.isHead ? "var(--accent)" : undefined}
                status={
                  <span
                    style={{
                      display: "flex",
                      gap: 3,
                      fontSize: "var(--fs-10)",
                      fontFamily: "var(--font-mono)",
                    }}
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
                  </span>
                }
              />
            ))}
          {local.length === 0 && (
            <div
              style={{
                padding: "4px 12px",
                fontSize: "var(--fs-11)",
                color: "var(--fg-3)",
              }}
            >
              (none)
            </div>
          )}
        </PGSidebarGroup>

        <PGSidebarGroup
          title="Remote"
          icon="link"
          count={remote.length}
          defaultOpen={true}
        >
          {remote
            .filter((b) => b.name.includes(branchFilter))
            .map((b) => (
              <PGSidebarRow key={b.name} icon="branch" label={b.name} />
            ))}
          {remote.length === 0 && (
            <div
              style={{
                padding: "4px 12px",
                fontSize: "var(--fs-11)",
                color: "var(--fg-3)",
              }}
            >
              (none)
            </div>
          )}
        </PGSidebarGroup>

        <PGSidebarGroup
          title="Tags"
          icon="tag"
          count={tags.length}
          defaultOpen={false}
        >
          {tags.map((t) => (
            <PGSidebarRow
              key={t.name}
              icon="tag"
              label={t.name}
              meta={t.shortOid}
            />
          ))}
        </PGSidebarGroup>

        <PGSidebarGroup
          title="Stashes"
          icon="stash"
          count={stashes.length}
          defaultOpen={false}
        >
          {stashes.map((s) => (
            <PGSidebarRow
              key={s.index}
              icon="stash"
              label={`stash@{${s.index}}`}
              meta={s.message.slice(0, 20)}
              onContextMenu={(e) =>
                onStashCtx(e, {
                  index: s.index,
                  name: `stash@{${s.index}}`,
                })
              }
            />
          ))}
        </PGSidebarGroup>
        {stashMenu}

        <PGSidebarGroup
          title="Remotes"
          icon="link"
          count={remotes.length}
          defaultOpen={false}
        >
          {remotes.map((r) => (
            <PGSidebarRow
              key={r.name}
              icon="link"
              label={r.name}
              meta={r.url ?? "(no url)"}
            />
          ))}
        </PGSidebarGroup>
      </div>
    </PGPrimarySidebar>
  );
}

function AppStatusBar() {
  const repo = useRepoStore((s) => s.current);
  const branches = useRepoStore((s) => s.branches);
  const status = useRepoStore((s) => s.status);
  const loading = useRepoStore((s) => s.loading);

  if (!repo) {
    return (
      <PGStatusBar
        left={<PGStatusItem label="No repository open" />}
        right={<PGStatusItem icon="info" label="⌘O to open…" />}
      />
    );
  }

  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const dirty = status.filter(
    (s) => isStaged(s) || isUnstaged(s),
  ).length;
  const conflicts = status.filter(
    (s) => s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted",
  ).length;

  return (
    <PGStatusBar
      left={
        <>
          {head && (
            <PGStatusItem
              icon="branch"
              label={head.name}
              tone="accent"
            />
          )}
          {(ahead > 0 || behind > 0) && (
            <PGStatusItem
              icon="sync"
              label={`↑${ahead} ↓${behind}`}
            />
          )}
          <PGStatusItem
            icon="dot"
            label={`${dirty} changed`}
            tone={dirty > 0 ? "warn" : "default"}
          />
          {conflicts > 0 && (
            <PGStatusItem
              icon="conflict"
              label={`${conflicts} conflict${conflicts !== 1 ? "s" : ""}`}
              tone="danger"
            />
          )}
          {loading && <PGStatusItem icon="sync" label="syncing…" />}
        </>
      }
      right={<PGStatusItem label={repo.path} />}
    />
  );
}
