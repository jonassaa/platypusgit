import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import {
  PGActivityBar,
  PGButton,
  PGDialogHost,
  PGErrorBanner,
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
import { CompareScreen } from "@/screens/Compare";
import { FileHistoryScreen } from "@/screens/FileHistory";
import { BlameScreen } from "@/screens/Blame";
import { SettingsScreen } from "@/screens/Settings";
import { PullsScreen } from "@/screens/Pulls";
import { SubmodulesScreen } from "@/screens/Submodules";
import { WorktreesScreen } from "@/screens/Worktrees";

import {
  applyNetProgress,
  applyRebaseProgress,
  useRepoStore,
} from "@/features/repo/useRepoStore";
import { useFsWatch } from "@/features/repo/useFsWatch";
import { startAutoFetch } from "@/features/repo/autoFetch";
import { ActivityStatus } from "@/features/repo/ActivityStatus";
import { LoadingStatus } from "@/features/repo/LoadingStatus";
import { primaryActivity } from "@/features/repo/repoActivity";
import type { NetProgress, RebaseProgress } from "@/lib/types";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { RepoTabs } from "@/features/repo/RepoTabs";
import { headUpstream, openRepoDialog } from "@/features/repo/ops";
import { windowTitleFor } from "@/features/repo/windowTitle";
import { indexOfTab, labelTabs } from "@/features/repo/tabs";
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
import { TerminalPanel } from "@/features/terminal";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { BranchChip } from "@/features/branches/BranchChip";
import { CloneDialog } from "@/features/create/CloneDialog";
import { CredentialDialog } from "@/features/auth/CredentialDialog";
import { InitDialog } from "@/features/create/InitDialog";
import { CreateTagDialog } from "@/features/tags/CreateTagDialog";
import { OperationBar } from "@/features/repo/OperationBar";
import { useSubmodulesStore } from "@/features/submodules/useSubmodulesStore";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { openMergeWindow } from "@/features/merge/openMergeWindow";
import { UpdateChip } from "@/features/update/UpdateChip";
import { UpdatePanel } from "@/features/update/UpdatePanel";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { warmSyntax } from "@/lib/syntax";
import { BranchPicker } from "@/features/branches/BranchPicker";
import {
  currentBranch,
  isConflicted,
  isStaged,
  isUnstaged,
  totalAheadBehind,
} from "@/lib/derive";

export type ScreenId =
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
  | "compare"
  | "fileHistory"
  | "blame"
  | "submodules"
  | "worktrees"
  | "settings";

// Deep views are reachable ONLY via a nav intent (no activity-bar entry). They
// carry no valid payload after a reload and have no "you are here" anchor, so
// they must not be restored from localStorage — see the reload-guard below.
const DEEP_VIEWS = new Set<ScreenId>([
  "commitDiff",
  "compare",
  "fileHistory",
  "blame",
]);

/**
 * Compile-time exhaustiveness assertion for the nav-intent routing switch
 * below: an unrouted `NavIntent` kind reaches the `default` clause as something
 * other than `never`, and the build fails.
 *
 * Runtime is deliberately a no-op. It runs inside a React effect, where
 * throwing would take the whole window down over a value TypeScript already
 * proved impossible — and an intent that reaches nothing is a dead menu item,
 * not a reason to lose the user's session.
 */
function assertNever(value: never): void {
  void value;
}

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
  submodules: "nav.submodules",
  worktrees: "nav.worktrees",
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
  // #93. Both are empty for most repositories, and that is fine: a repo WITH
  // submodules or linked worktrees had nowhere at all to see them before, and a
  // conditional activity-bar entry would make the bar's geometry move under the
  // user as they switch repositories.
  { id: "submodules", icon: "submodule", label: "Submodules" },
  { id: "worktrees", icon: "worktree", label: "Worktrees" },
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
  // else reads the key. Tabs do not resurrect it: a restored tab is created on
  // History too — the per-tab screen below is remembered within a session only.
  const [screen, setScreen] = React.useState<ScreenId>("history");

  // Reopen last session's repositories (#90). Lazy: only the tab that was
  // active is actually opened; the rest open when first activated. Runs before
  // useCliLaunch's intent lands, so a forwarded `pgit <path>` focuses the
  // restored tab for that path instead of adding a duplicate.
  React.useEffect(() => {
    void useTabsStore.getState().restoreSession();
  }, []);

  // Latest screen, readable synchronously from the intent effect below without
  // making it a dependency (so origin capture sees the pre-switch screen).
  const screenRef = React.useRef(screen);
  screenRef.current = screen;

  // Hydrate the submodule and worktree lists once per opened repository (#93).
  //
  // Surfaces that only READ those stores — the palette's submodule/worktree rows,
  // the Files-screen row menu — have to be accurate before the user has visited
  // either screen. Both lists are cheap (`list_submodules` returns empty with no
  // `.gitmodules`) and both `refresh` calls swallow their own errors.
  //
  // Deliberately an effect here rather than a module-level `useRepoStore.subscribe`
  // inside those stores: they are reachable from `@/design`'s context-menu module,
  // so a store-module side effect runs mid-cycle while `useRepoStore` is still
  // uninitialized.
  React.useEffect(() => {
    if (!repo) return;
    void useSubmodulesStore.getState().refresh();
    void useWorktreesStore.getState().refresh();
  }, [repo]);

  // Progress ticks from the backend's long operations (#296).
  //
  // Subscribed once for the app's lifetime, not per repository: the events are
  // app-global and carry their own `repoId`, and `applyNetProgress` /
  // `applyRebaseProgress` drop anything that is not for the open one. Resubscribing
  // on every tab switch would open a window where ticks are silently lost.
  React.useEffect(() => {
    const subs = [
      listen<NetProgress>("net://progress", (e) => applyNetProgress(e.payload)),
      listen<RebaseProgress>("rebase://progress", (e) => applyRebaseProgress(e.payload)),
    ];
    return () => {
      for (const sub of subs) void sub.then((un) => un()).catch(() => {});
    };
  }, []);

  // The working copy stays live while the user is in another window (#239).
  // App-global subscription inside; the watch itself follows this repository.
  useFsWatch(repo?.id ?? null);

  // Auto-fetch on a timer, and the deadline that belongs to timer-started
  // fetches alone (#234, #263). The policy — which fetches may be killed on a
  // clock and which may never be — lives in `startAutoFetch` rather than in this
  // effect body, so it can be tested without rendering the shell.
  const autoFetchEnabled = useSettingsStore((s) => s.autoFetchEnabled);
  const autoFetchMinutes = useSettingsStore((s) => s.autoFetchMinutes);
  React.useEffect(() => {
    if (!repo || !autoFetchEnabled) return;
    return startAutoFetch(autoFetchMinutes);
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
  //
  // Deliberately NOT gated here: the "check for updates" preference (#237) is
  // enforced inside check() itself, so this call site, Settings and the command
  // palette cannot drift apart. `check(false)` says "automatic", which is the
  // only thing the store needs to decide whether a request is allowed.
  React.useEffect(() => {
    const t = setTimeout(() => {
      void useUpdateStore.getState().check(false);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Warm the syntax worker at idle, so the first file the user opens pays only
  // its own grammar + tokenize rather than worker spawn + Shiki set-up too.
  // Idle, not launch: highlighting must never compete with first paint.
  React.useEffect(() => {
    if (typeof requestIdleCallback !== "function") return;
    const id = requestIdleCallback(() => warmSyntax());
    return () => cancelIdleCallback(id);
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
    // Per-tab screen: remember where THIS repository is, so switching away and
    // back does not dump you on History with your place lost.
    useTabsStore.getState().rememberScreen(id);
  }, []);
  React.useEffect(() => {
    useFocusStore.getState().requestContentFocus();
  }, [screen, entryTick]);

  // Restore the incoming tab's screen on every switch. Skipped on first mount
  // so launch still lands on History (a restored tab remembers nothing).
  const activePath = useTabsStore((s) => s.activePath);
  const firstTabEffect = React.useRef(true);
  React.useEffect(() => {
    if (firstTabEffect.current) {
      firstTabEffect.current = false;
      return;
    }
    const remembered = useTabsStore.getState().activeScreen();
    setScreen((remembered as ScreenId | null) ?? "history");
    setEntryTick((t) => t + 1);
  }, [activePath]);

  // Name the active repository and its checked-out branch in the OS window
  // title (#217) — otherwise every window/tab reads as the identical
  // "PlatypusGit" in the window switcher, dock, and Mission Control.
  // `headInfo` follows checkouts, unlike `repo.head`; the same shape
  // `MergeWindow.tsx` uses for its own title.
  //
  // The label is derived INSIDE the selector so what this component
  // subscribes to is a string, which zustand compares by value. Selecting
  // `s.tabs` instead would re-render the whole shell (titlebar, RepoTabs,
  // the dialogs, AppBody, CommandPalette) on every write to any tab —
  // `refreshBadges()` patches one tab per inactive repo on each window
  // focus, so alt-tabbing back would cost a full-tree render per open tab.
  // Same lesson as the `useRepoStore()` note further down this file.
  const repoLabel = useTabsStore((s) => {
    const i = indexOfTab(s.tabs, s.activePath);
    return i < 0 ? null : labelTabs(s.tabs)[i] ?? null;
  });
  const headInfo = useRepoStore((s) => s.headInfo);
  React.useEffect(() => {
    void getCurrentWindow().setTitle(windowTitleFor(repoLabel, headInfo));
  }, [repoLabel, headInfo]);

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
      case "ref-compare":
        // The sides live in `useCompareStore` (the screen keeps them mutable);
        // the intent only routes.
        enterDeep("compare");
        break;
      case "file-history":
        enterDeep("fileHistory");
        break;
      case "blame":
        enterDeep("blame");
        break;
      case "rebase-plan":
      // The base-only variant (186). Same destination: the Rebase screen owns
      // the range walk and the plan either way.
      case "rebase-onto":
        setScreen("rebase");
        break;
      // Both stash comparisons are `CommitDiff` targets (#133) — the entry
      // against its own first parent, and the entry against the working tree.
      // They are one case because that screen's `Target` union carries both and
      // fetches each on its own; the routing decision is identical.
      case "stash-diff":
      case "stash-vs-wt":
        enterDeep("commitDiff");
        break;
      case "switch-screen":
        // enterScreen, not setScreen: a nav chord for the screen you are
        // already on still means "put me in this screen" — see entryTick.
        enterScreen(intent.screen as ScreenId);
        clearIntent();
        break;
      default:
        // Every `NavIntent` kind must be routed above, and this is what forces
        // it. `stash-vs-wt` was declared in the union, emitted by the stash
        // context menu and fully handled by `CommitDiff` — but had no case
        // here, so the menu item set an intent and NOTHING navigated (#133).
        // Nothing failed: not the type-checker, not the unit tests, not e2e.
        //
        // A kind that must deliberately leave the user where they are still
        // needs an explicit `case … break;` saying so, plus an entry in
        // `AppShell.navroutes.test.tsx`'s allow-list with the reason.
        assertNever(intent);
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
    compare: <CompareScreen />,
    fileHistory: <FileHistoryScreen />,
    blame: <BlameScreen />,
    submodules: <SubmodulesScreen />,
    worktrees: <WorktreesScreen />,
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
      {/* Open repositories. Its own row: the titlebar has no space left, and
          keeping it out of there preserves the drag region. */}
      <RepoTabs />
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
      {/* Create tag (#132). Mounted here rather than in a screen because two of
          its three call sites — a context-menu item builder and a palette step —
          are not React components. Renders nothing until one opens it. */}
      <CreateTagDialog />
      {/* One banner, shared with Reflog (#212). It leads with written prose or
          with nothing — never with the enum's own spelling — and preserves the
          newlines in git's multi-line advice. The remediation the two terse
          variants need travels with the text, in `errorBannerText`. */}
      {error && <PGErrorBanner error={error} onDismiss={clearError} />}
      {/* Below the banner (which is transient) and above the screens (which
          all need to know): the standing "a merge/rebase is open" signal, and
          the only route to the resolver now that the Conflicts tab is gone. */}
      <OperationBar />
      {/* A tab whose repository is not loaded yet (session restore is lazy) is
          neither "a repo is open" nor "no repo at all" — showing Welcome there
          would flash the landing screen on every switch into a pending tab. */}
      {!repo && screen !== "settings" && activePath ? (
        <TabLoadingScreen path={activePath} />
      ) : repo || screen === "settings" ? (
        <AppBody
          // Keyed by the active repository: a tab switch REMOUNTS the screen, so
          // History's selected commit, RepoBrowser's selected file and every
          // windowed list's scroll reset instead of carrying another
          // repository's oids and paths into this one.
          key={activePath ?? "no-repo"}
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

/** The body while the active tab's repository is opening, or after its open was
 *  refused. The error banner above carries the reason; this carries the way out. */
function TabLoadingScreen({ path }: { path: string }) {
  const failed = useTabsStore(
    (s) => s.tabs.find((t) => t.path === path)?.status === "failed",
  );
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return (
    <div
      data-testid="tab-loading"
      data-failed={failed ? "true" : "false"}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "var(--bg-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        color: "var(--fg-2)",
      }}
    >
      {failed ? (
        <>
          <div style={{ color: "var(--fg-0)" }}>Could not open {name}</div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>{path}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <PGButton
              size="sm"
              variant="default"
              icon="sync"
              onClick={() => void useTabsStore.getState().activate(path)}
            >
              Retry
            </PGButton>
            <PGButton
              size="sm"
              variant="ghost"
              onClick={() => void useTabsStore.getState().close(path)}
            >
              Close tab
            </PGButton>
          </div>
        </>
      ) : (
        <div>Opening {name}…</div>
      )}
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
          // The screen the shell actually routed to, readable without depending
          // on any screen's internals — deep views have no activity-bar slot to
          // read it off. A nav intent that reaches no `case` in the routing
          // switch leaves this on the previous screen, which is exactly what
          // AppShell.navroutes.test.tsx asserts against.
          data-pg-screen={screen}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-0)",
          }}
        >
          {screens[screen]}
          {/* The terminal docks BELOW the routed screen and inside the same
              column, so it spans the screen's width and not the activity bar's
              (#243). This div is already a flex column, so the panel's fixed
              height composes with the screen's `flex: 1` on its own. */}
          <TerminalPanel />
        </div>
      </div>
    </div>
  );
}

function AppTitlebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const repo = useRepoStore((s) => s.current);
  const branches = useRepoStore((s) => s.branches);
  const status = useRepoStore((s) => s.status);
  // Booleans, not the `activity` object: a fetch publishes a progress tick many
  // times a second, and selecting the object would re-render the whole toolbar
  // on each one. These flip twice per operation (#296).
  const fetching = useRepoStore((s) => !!s.activity.fetch);
  const pulling = useRepoStore((s) => !!s.activity.pull);
  const pushing = useRepoStore((s) => !!s.activity.push);
  const refresh = useRepoStore((s) => s.refreshAll);
  const activePath = useTabsStore((s) => s.activePath);
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
  // getState(), not a hook: these run inside event handlers, so they need no
  // subscription — the selector-less `useRepoStore()` that used to sit here
  // re-rendered the whole titlebar (BranchChip, UpdateChip, picker) on EVERY
  // store write, including per-page log appends and loading flags.
  const onFetch = () => {
    useRepoStore.getState().fetchAll();
  };

  const onPull = () => {
    if (!upstream) {
      pgFlash("No upstream configured for current branch");
      return;
    }
    useRepoStore.getState().pull(upstream[0], upstream[1], defaultPullMode);
  };

  const onPush = () => {
    if (!upstream) {
      pgFlash("No upstream configured — run git push -u origin <branch> first");
      return;
    }
    useRepoStore.getState().push(upstream[0], upstream[1]);
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
                  loading={fetching}
                >
                  Fetch
                </PGButton>
                <PGButton
                  size="sm"
                  variant="default"
                  icon="pull"
                  onClick={onPull}
                  loading={pulling}
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
                  loading={pushing}
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
                <PGButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (activePath) void useTabsStore.getState().close(activePath);
                  }}
                >
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
  // A boolean, so the status bar does not re-render on every progress tick —
  // `ActivityStatus` is the leaf that subscribes to the ticks themselves. Which
  // entry wins, the bar, the elapsed clock and the Cancel button all live there
  // now (#296); this only needs to know whether to fall back to "syncing…".
  const busy = useRepoStore((s) => primaryActivity(s.activity) !== null);

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
          {!busy && <LoadingStatus />}
          <ActivityStatus />
        </>
      }
      right={<PGStatusItem label={repo.path} />}
    />
  );
}
