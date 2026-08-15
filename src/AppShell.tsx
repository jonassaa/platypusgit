import { listen } from "@tauri-apps/api/event";
import React from "react";
import {
  PGActivityBar,
  PGButton,
  PGDialogHost,
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
import { RebaseScreen } from "@/screens/Rebase";
import { RemoteScreen } from "@/screens/Remote";
import { WelcomeScreen } from "@/screens/Welcome";
import { ReflogScreen } from "@/screens/Reflog";
import { CommitDiffScreen } from "@/screens/CommitDiff";
import { FileHistoryScreen } from "@/screens/FileHistory";
import { BlameScreen } from "@/screens/Blame";
import { SettingsScreen } from "@/screens/Settings";
import { PullsScreen } from "@/screens/Pulls";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { headUpstream, openRepoDialog } from "@/features/repo/ops";
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
import { CloneDialog } from "@/features/create/CloneDialog";
import { CredentialDialog } from "@/features/auth/CredentialDialog";
import { InitDialog } from "@/features/create/InitDialog";
import { OperationBar } from "@/features/repo/OperationBar";
import { openMergeWindow } from "@/features/merge/openMergeWindow";
import { UpdateChip } from "@/features/update/UpdateChip";
import { UpdatePanel } from "@/features/update/UpdatePanel";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { BranchPicker } from "@/features/branches/BranchPicker";
import {
  DUBIOUS_OWNERSHIP_HELP,
  EMBEDDED_REPO_HELP,
  appErrorMessage,
  dubiousOwnershipPath,
} from "@/lib/errors";
import {
  currentBranch,
  isConflicted,
  isStaged,
  isUnstaged,
  totalAheadBehind,
} from "@/lib/derive";

type ScreenId =
  | "repo"
  | "commit"
  | "history"
  | "branches"
  | "rebase"
  | "remote"
  | "pulls"
  | "diff"
  | "reflog"
  | "commitDiff"
  | "fileHistory"
  | "blame"
  | "settings";

// Deep views are reachable ONLY via a nav intent (no activity-bar entry). They
// carry no valid payload after a reload and have no "you are here" anchor, so
// they must not be restored from localStorage — see the reload-guard below.
const DEEP_VIEWS = new Set<ScreenId>(["commitDiff", "fileHistory", "blame"]);

// Maps each activity-bar item id to the navigation action whose chord it shows.
const ACTIVITY_ACTION: Record<string, ActionId> = {
  repo: "nav.files",
  commit: "nav.commit",
  history: "nav.history",
  branches: "nav.branches",
  rebase: "nav.rebase",
  remote: "nav.remote",
  pulls: "nav.pulls",
  diff: "nav.diff",
  reflog: "nav.reflog",
};

// Tooltip shortcuts are derived live from the active preset via chordFor
// (see AppBody) — no hardcoded chord strings, they'd drift from the keymap.
// History leads: it is the screen the app opens on, so it owns the first slot.
const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "history", icon: "history", label: "History" },
  { id: "repo", icon: "folder", label: "Files" },
  { id: "commit", icon: "commit", label: "Commit" },
  { id: "branches", icon: "branch", label: "Branches" },
  { id: "rebase", icon: "rebase", label: "Rebase" },
  { id: "remote", icon: "link", label: "Remotes" },
  { id: "pulls", icon: "pullRequest", label: "Pull requests" },
  { id: "diff", icon: "fileCode", label: "Diff viewer" },
  { id: "reflog", icon: "clock", label: "Reflog" },
];

// (There is no RESTORABLE whitelist any more: nothing is restored. Launch always
// lands on History, which also settles the "id retired between versions" problem
// the whitelist existed for — a stale `pg-screen` value can no longer be read.)

export function AppShell() {
  usePreventBrowserContextMenu();
  useCliLaunch();
  const repo = useRepoStore((s) => s.current);
  const error = useRepoStore((s) => s.error);
  const clearError = useRepoStore((s) => s.clearError);

  // Launch always lands on History — it is the screen that answers "what is
  // going on in this repo", so it is worth more than restoring wherever the
  // last session happened to end (a deep view or Settings, most annoyingly).
  // The old localStorage["pg-screen"] restore is gone with its write; nothing
  // else reads the key.
  const [screen, setScreen] = React.useState<ScreenId>("history");

  // Latest screen, readable synchronously from the intent effect below without
  // making it a dependency (so origin capture sees the pre-switch screen).
  const screenRef = React.useRef(screen);
  screenRef.current = screen;

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

  // Check for a newer release shortly after launch — non-blocking, and silent
  // on failure (offline, rate-limited). Manual re-check lives in Settings.
  React.useEffect(() => {
    const t = setTimeout(() => {
      void useUpdateStore.getState().check(false);
    }, 2000);
    return () => clearTimeout(t);
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

  // On entering a screen, focus its primary pane so the keyboard is immediately
  // live (runs on mount too → the initial screen gets focus).
  //
  // `entryTick` is what makes re-picking the CURRENT screen count as entering
  // it. Clicking an activity-bar entry moves DOM focus to that button; with
  // `[screen]` alone the effect can't fire when the screen didn't change, so
  // focus stayed stranded on the bar and every list chord went nowhere.
  const [entryTick, setEntryTick] = React.useState(0);
  const enterScreen = React.useCallback((id: ScreenId) => {
    setScreen(id);
    setEntryTick((t) => t + 1);
  }, []);
  React.useEffect(() => {
    useFocusStore.getState().requestContentFocus();
  }, [screen, entryTick]);

  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  React.useEffect(() => {
    if (!intent) return;
    // Enter a deep view, recording the originating screen for its Back button.
    // Don't overwrite when coming from another deep view — Back then returns
    // to the last "real" screen instead of chaining deep views.
    const enterDeep = (target: ScreenId) => {
      if (!DEEP_VIEWS.has(screenRef.current)) {
        useNavStore.getState().setDeepOrigin(screenRef.current);
      }
      setScreen(target);
    };
    switch (intent.kind) {
      case "diff-file":
        setScreen("diff");
        break;
      case "commit-self":
      case "commit-vs-wt":
      case "commit-vs-commit":
        enterDeep("commitDiff");
        break;
      case "file-history":
        enterDeep("fileHistory");
        break;
      case "blame":
        enterDeep("blame");
        break;
      case "rebase-plan":
        setScreen("rebase");
        break;
      case "stash-diff":
        enterDeep("commitDiff");
        break;
      case "switch-screen":
        // enterScreen, not setScreen: a nav chord for the screen you are
        // already on still means "put me in this screen" — see entryTick.
        enterScreen(intent.screen as ScreenId);
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
    rebase: <RebaseScreen />,
    remote: <RemoteScreen />,
    pulls: <PullsScreen />,
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
        position: "relative",
      }}
    >
      <AppTitlebar onOpenSettings={() => enterScreen("settings")} />
      {/* Styled confirm/prompt host — pgConfirm/pgPrompt resolve false/null
          unless one of these is mounted. */}
      <PGDialogHost />
      {/* Credential prompt for a network op that failed to authenticate (#61 D5).
          Renders nothing until an Auth error raises a challenge. */}
      <CredentialDialog />
      <UpdatePanel />
      <CheatSheet />
      <CloneDialog />
      <InitDialog />
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
          {/* The backend keeps EmbeddedRepo and DubiousOwnership terse like
              the rest of the enum; the actionable half of the story lives in
              the UI. A dismissed trust prompt must not leave the user staring
              at libgit2's sentence with nothing to do about it. */}
          <strong>
            {error.kind === "EmbeddedRepo"
              ? "Embedded repository"
              : error.kind === "DubiousOwnership"
                ? "Repository owned by another user"
                : error.kind}
            :
          </strong>
          <span style={{ flex: 1 }}>
            {error.kind === "EmbeddedRepo"
              ? `${appErrorMessage(error).replace(/^embedded repository: /, "")} — ${EMBEDDED_REPO_HELP}`
              : error.kind === "DubiousOwnership"
                ? `${dubiousOwnershipPath(error)} — ${DUBIOUS_OWNERSHIP_HELP}`
                : appErrorMessage(error)}
          </span>
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
      {/* Below the banner (which is transient) and above the screens (which
          all need to know): the standing "a merge/rebase is open" signal, and
          the only route to the resolver now that the Conflicts tab is gone. */}
      <OperationBar />
      {repo || screen === "settings" ? (
        <AppBody
          screen={screen}
          screens={screens}
          setScreen={enterScreen}
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

  const onOpen = () => {
    void openRepoDialog();
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
            <UpdateChip />
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
  const conflicts = status.filter(isConflicted).length;

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
              // A count you cannot act on is a dead end — this is the
              // second route to the resolver, after the operation bar.
              onClick={() => void openMergeWindow(repo.id)}
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
