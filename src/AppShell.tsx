import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import React from "react";
import {
  PGActivityBar,
  PGButton,
  PGIconButton,
  PGStatusBar,
  PGStatusItem,
  PGTitlebar,
  pgFlash,
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
import { SettingsScreen } from "@/screens/Settings";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { headUpstream } from "@/features/repo/ops";
import { useNavStore } from "@/features/nav/useNavStore";
import { useCliLaunch } from "@/features/cli/useCliLaunch";
import {
  useKeymapStore,
  useFocusStore,
  usePaneList,
  PGPane,
  chordFor,
  CheatSheet,
  type ActionId,
} from "@/features/keymap";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { BranchChip } from "@/features/branches/BranchChip";
import { BranchPicker } from "@/features/branches/BranchPicker";
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
  | "diff"
  | "reflog"
  | "commitDiff"
  | "fileHistory"
  | "blame"
  | "settings";

// Maps each activity-bar item id to the navigation action whose chord it shows.
const ACTIVITY_ACTION: Record<string, ActionId> = {
  repo: "nav.files",
  commit: "nav.commit",
  history: "nav.history",
  branches: "nav.branches",
  conflict: "nav.conflict",
  rebase: "nav.rebase",
  remote: "nav.remote",
  diff: "nav.diff",
  reflog: "nav.reflog",
};

// Tooltip shortcuts are derived live from the active preset via chordFor
// (see AppBody) — no hardcoded chord strings, they'd drift from the keymap.
const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "repo", icon: "folder", label: "Files" },
  { id: "commit", icon: "commit", label: "Commit" },
  { id: "history", icon: "history", label: "History" },
  { id: "branches", icon: "branch", label: "Branches" },
  { id: "conflict", icon: "conflict", label: "Conflicts" },
  { id: "rebase", icon: "rebase", label: "Rebase" },
  { id: "remote", icon: "link", label: "Remotes" },
  { id: "diff", icon: "fileCode", label: "Diff viewer" },
  { id: "reflog", icon: "clock", label: "Reflog" },
];

export function AppShell() {
  usePreventBrowserContextMenu();
  useCliLaunch();
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

  const autoFetchEnabled = useSettingsStore((s) => s.autoFetchEnabled);
  const autoFetchMinutes = useSettingsStore((s) => s.autoFetchMinutes);
  React.useEffect(() => {
    if (!repo || !autoFetchEnabled) return;
    const id = window.setInterval(
      () => {
        useRepoStore.getState().fetchAll();
      },
      Math.max(1, autoFetchMinutes) * 60_000,
    );
    return () => window.clearInterval(id);
  }, [repo, autoFetchEnabled, autoFetchMinutes]);

  // Single global keymap listener — resolves chord → action → handler or
  // default runner (see actions.ts). Navigation, palette, repo ops, pane
  // traversal, and the cheat-sheet are all catalog default runners now; this
  // component only routes screen switches (via nav intents) below.
  //
  // Capture phase: a global dispatcher must run before focused-element handlers
  // (e.g. the file tree's arrow-key navigation) get the event. Local handlers
  // check e.defaultPrevented so a dispatched key isn't double-handled.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      useKeymapStore.getState().dispatch(e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The merge resolver window stages resolutions out-of-band; reflect them.
  React.useEffect(() => {
    const un = listen("merge://resolved", () => {
      void useRepoStore.getState().refreshAll();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // On entering a screen, focus its first content pane so the keyboard is
  // immediately live (runs on mount too → initial screen gets focus).
  React.useEffect(() => {
    useFocusStore.getState().requestContentFocus();
  }, [screen]);

  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  React.useEffect(() => {
    if (!intent) return;
    switch (intent.kind) {
      case "diff-file":
        setScreen("diff");
        break;
      case "commit-self":
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
      case "rebase-plan":
        setScreen("rebase");
        break;
      case "stash-diff":
        setScreen("commitDiff");
        break;
      case "switch-screen":
        setScreen(intent.screen as ScreenId);
        clearIntent();
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
    settings: <SettingsScreen />,
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
      <AppTitlebar onOpenSettings={() => setScreen("settings")} />
      <CheatSheet />
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
      {repo || screen === "settings" ? (
        <AppBody
          screen={screen}
          screens={screens}
          setScreen={setScreen}
        />
      ) : (
        <WelcomeScreen />
      )}
      <AppStatusBar />
      <CommandPalette />
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
  const hasChanges = useRepoStore((s) => s.status.length > 0);
  // Re-derive shortcut labels when the active preset changes.
  const presetId = useKeymapStore((s) => s.activePresetId);
  const items = React.useMemo(
    () =>
      ACTIVITY_ITEMS.map((it) => ({
        ...it,
        shortcut: chordFor(ACTIVITY_ACTION[it.id] ?? "nav.files"),
        ...(it.id === "commit" ? { badge: hasChanges } : {}),
      })),
    // presetId drives the shortcut recompute via chordFor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasChanges, presetId],
  );

  // Activity bar as a keyboard pane: Alt+← focuses it, ↑/↓ move a highlight
  // cursor, Enter switches to that screen.
  const ACTIVITY_BAR_ID = "activitybar";
  const barFocused = useFocusStore((s) => s.focused === ACTIVITY_BAR_ID);
  const screenIndex = Math.max(
    0,
    items.findIndex((it) => it.id === screen),
  );
  const [highlight, setHighlight] = React.useState(screenIndex);
  // Reset the highlight to the active screen each time the bar gains focus.
  React.useEffect(() => {
    if (barFocused) setHighlight(screenIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barFocused]);
  usePaneList({
    paneId: ACTIVITY_BAR_ID,
    count: items.length,
    selectedIndex: highlight,
    onSelect: setHighlight,
    onActivate: (i) => {
      const it = items[i];
      if (it) setScreen(it.id as ScreenId);
    },
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <PGPane id={ACTIVITY_BAR_ID} isBar style={{ flexShrink: 0 }}>
        <PGActivityBar
          value={screen}
          onChange={(id) => setScreen(id as ScreenId)}
          items={items}
          settingsActive={screen === "settings"}
          onSettingsClick={() => setScreen("settings")}
          highlightIndex={barFocused ? highlight : undefined}
        />
      </PGPane>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
        }}
      >
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
    </div>
  );
}

function AppTitlebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const repo = useRepoStore((s) => s.current);
  const branches = useRepoStore((s) => s.branches);
  const status = useRepoStore((s) => s.status);
  const activity = useRepoStore((s) => s.activity);
  const refresh = useRepoStore((s) => s.refreshAll);
  const close = useRepoStore((s) => s.closeRepo);
  const openStore = useRepoStore((s) => s.openRepo);
  const store = useRepoStore();
  const defaultPullMode = useSettingsStore((s) => s.defaultPullMode);

  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const dirty = status.filter(
    (s) => isStaged(s) || isUnstaged(s),
  ).length;
  const repoName = repo?.path.split("/").filter(Boolean).pop() ?? "—";

  const upstream = headUpstream(head?.upstream, head?.name);

  const [pickerAnchor, setPickerAnchor] = React.useState<HTMLElement | null>(
    null,
  );

  const onOpen = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") await openStore(selected);
  };

  // Same ops the keymap default runners and palette use (features/repo/ops.ts).
  const onFetch = () => {
    store.fetchAll();
  };

  const onPull = () => {
    if (!upstream) {
      pgFlash("No upstream configured for current branch");
      return;
    }
    store.pull(upstream[0], upstream[1], defaultPullMode);
  };

  const onPush = () => {
    if (!upstream) {
      pgFlash("No upstream configured — run git push -u origin <branch> first");
      return;
    }
    store.push(upstream[0], upstream[1]);
  };

  return (
    <>
      <PGTitlebar
        repoName={repoName}
        branch={<BranchChip onClick={(el) => setPickerAnchor((prev) => (prev ? null : el))} />}
        dirty={dirty}
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
                  loading={!!activity.fetch}
                >
                  Fetch
                </PGButton>
                <PGButton
                  size="sm"
                  variant="default"
                  icon="pull"
                  onClick={onPull}
                  loading={!!activity.pull}
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
                  loading={!!activity.push}
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
            <PGIconButton
              icon="settings"
              size="md"
              title="Settings"
              onClick={onOpenSettings}
            />
          </div>
        }
      />
      <BranchPicker
        anchor={pickerAnchor}
        open={!!pickerAnchor}
        onClose={() => setPickerAnchor(null)}
      />
    </>
  );
}

function AppStatusBar() {
  const repo = useRepoStore((s) => s.current);
  const branches = useRepoStore((s) => s.branches);
  const status = useRepoStore((s) => s.status);
  const loading = useRepoStore((s) => s.loading);
  const activity = useRepoStore((s) => s.activity);
  // First non-empty activity entry wins — expected to be one at a time.
  const activityLabel =
    activity.push ?? activity.pull ?? activity.fetch ?? activity.stash ?? activity.branch ?? null;

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
          {loading && !activityLabel && <PGStatusItem icon="sync" label="syncing…" />}
          {activityLabel && (
            <PGStatusItem icon="sync" label={activityLabel} tone="accent" />
          )}
        </>
      }
      right={<PGStatusItem label={repo.path} />}
    />
  );
}
