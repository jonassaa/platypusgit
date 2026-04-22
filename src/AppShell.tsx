import { open } from "@tauri-apps/plugin-dialog";
import React from "react";
import {
  PGActivityBar,
  PGButton,
  PGIconButton,
  PGPrimarySidebar,
  PGSearchInput,
  PGSidebarGroup,
  PGSidebarRow,
  PGStatusBar,
  PGStatusItem,
  PGTitlebar,
  pgFlash,
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

import { useRepoStore } from "@/features/repo/useRepoStore";
import { appErrorMessage } from "@/lib/errors";
import {
  currentBranch,
  isStaged,
  isUnstaged,
  totalAheadBehind,
} from "@/lib/derive";

type ScreenId =
  | "repo"
  | "commit"
  | "history"
  | "branches"
  | "conflict"
  | "rebase"
  | "remote"
  | "diff";

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
];

export function AppShell() {
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

  const screens: Record<ScreenId, React.ReactNode> = {
    repo: <RepoBrowserScreen />,
    commit: <CommitPanelScreen />,
    history: <HistoryScreen />,
    diff: <DiffViewerScreen />,
    branches: <BranchesScreen />,
    conflict: <ConflictScreen />,
    rebase: <RebaseScreen />,
    remote: <RemoteScreen />,
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
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <PGActivityBar
            value={screen}
            onChange={(id) => setScreen(id as ScreenId)}
            items={ACTIVITY_ITEMS}
          />
          <AppSidebar />
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
        </div>
      ) : (
        <WelcomeScreen />
      )}
      <AppStatusBar />
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

  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const dirty = status.filter(
    (s) => isStaged(s) || isUnstaged(s),
  ).length;
  const repoName = repo?.path.split("/").filter(Boolean).pop() ?? "—";

  const onOpen = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") await openStore(selected);
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
                disabled
                onClick={() => pgFlash("fetch is not wired up yet")}
              >
                Fetch
              </PGButton>
              <PGButton
                size="sm"
                variant="default"
                icon="pull"
                disabled
                onClick={() => pgFlash("pull is not wired up yet")}
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
                disabled
                onClick={() => pgFlash("push is not wired up yet")}
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

function AppSidebar() {
  const [branchFilter, setBranchFilter] = React.useState("");
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);
  const stashes = useRepoStore((s) => s.stashes);
  const remotes = useRepoStore((s) => s.remotes);

  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  return (
    <PGPrimarySidebar width={260}>
      <div
        style={{
          padding: 8,
          borderBottom: "1px solid var(--border-0)",
        }}
      >
        <PGSearchInput
          value={branchFilter}
          onChange={setBranchFilter}
          placeholder="Filter branches…"
          shortcut="⌘P"
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
              onClick={() => pgFlash("new branch is not wired up yet")}
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
            />
          ))}
        </PGSidebarGroup>

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
