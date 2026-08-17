// Repository tabs — the store (#90). Owns WHICH repositories are open;
// `useRepoStore` owns the ACTIVE one's data.
//
// The dependency runs one way — `useTabsStore` → `useRepoStore` — so there is no
// import cycle. That is why `openRepo` lives here and not on the repo store:
// "open a repository" is a statement about the open set, and every call site in
// the app (⌘O, a recents row, a clone, an init, a forwarded `pgit …`) means
// "open it in a tab".
//
// Switching is snapshot → hydrate → refresh:
//   1. freeze the live slice into the outgoing tab (so coming back is instant),
//   2. write the incoming tab's frozen slice as a WHOLE (repoSlice.ts),
//   3. refresh, because a cached view is not disk truth.
//
// Two guards keep concurrency honest:
//   - `activationSeq` — bumped on every activate/open, re-checked after each
//     await, so a session restore racing a forwarded CLI launch cannot both win.
//   - `useRepoStore`'s own `setFor`, which drops a fetch that resolved after the
//     user moved on.

import { create } from "zustand";

import { pgConfirm } from "@/design";
import {
  closeMergeWindow,
  mergeWindowHoldsRepo,
} from "@/features/merge/openMergeWindow";
import { closeRepo as closeRepoIpc, getStatus } from "@/lib/tauri";
import type { RepoHandle } from "@/lib/types";
import { isConflicted, isStaged, isUnstaged } from "@/lib/derive";
import { warn as logWarn } from "@tauri-apps/plugin-log";
import { describeError } from "@/lib/errors";
import { emptySlice, frozenSlice, type RepoSlice } from "./repoSlice";
import { useRepoStore } from "./useRepoStore";
import {
  closeNeighbour,
  cycle,
  findTab,
  indexOfTab,
  labelTabs,
  loadOpenRepos,
  newTab,
  patchTab,
  removeTab,
  saveOpenRepos,
  upsertTab,
  type RepoTab,
} from "./tabs";

interface TabsState {
  tabs: RepoTab[];
  /** Path of the active tab, or null (no repository open → Welcome). */
  activePath: string | null;
  /** Monotonic activation counter — the async race guard. */
  activationSeq: number;
  /** Path whose open is in flight, so a second request for the SAME tab waits
   *  instead of opening the repository twice. */
  activating: string | null;
  /**
   * Open `path` in a tab: focuses the existing tab when the path is already
   * open, otherwise opens the repository and appends a tab. The single entry
   * point for opening a repository anywhere in the app.
   */
  openRepo: (path: string) => Promise<void>;
  /** Make the tab at `path` active, opening it if it is still pending. */
  activate: (path: string) => Promise<void>;
  /** Close one tab, evicting its repository backend-side. */
  close: (path: string) => Promise<void>;
  closeOthers: (keepPath: string) => Promise<void>;
  closeAll: () => Promise<void>;
  /** Cycle to the next/previous tab (wrapping). */
  step: (delta: 1 | -1) => Promise<void>;
  /** Activate the 1-based nth tab; no-op when there are fewer. */
  selectIndex: (oneBased: number) => Promise<void>;
  /** Record the screen the ACTIVE tab is on (session-only). */
  rememberScreen: (screen: string) => void;
  /** Screen remembered for the active tab, or null. */
  activeScreen: () => string | null;
  /** Re-read `status` for every open INACTIVE tab so its badge is honest. */
  refreshBadges: () => Promise<void>;
  /** Recreate the persisted open set as pending tabs and activate the persisted
   *  active one. Lazy: only that one repository is actually opened. */
  restoreSession: () => Promise<void>;
  /** Display labels, parent-disambiguated for colliding names. */
  labels: () => string[];
}

function countsOf(slice: RepoSlice): { dirty: number; conflicts: number } {
  return {
    dirty: slice.status.filter((s) => isStaged(s) || isUnstaged(s)).length,
    conflicts: slice.status.filter(isConflicted).length,
  };
}

export const useTabsStore = create<TabsState>((set, get) => {
  const persist = () => saveOpenRepos(get().tabs, get().activePath);

  /** Freeze the live slice into the tab at `path` (it is about to lose it). */
  const snapshotInto = (path: string) => {
    const slice = frozenSlice(useRepoStore.getState().snapshot());
    set((s) => ({
      tabs: patchTab(s.tabs, path, { slice, ...countsOf(slice) }),
    }));
  };

  /** Bump the race guard and return the token to check after each await. */
  const beginActivation = (): number => {
    const seq = get().activationSeq + 1;
    set({ activationSeq: seq });
    return seq;
  };
  const stillCurrent = (seq: number) => get().activationSeq === seq;

  /**
   * Make `tab` the live repository. Assumes the outgoing tab was already
   * snapshotted. Opens the repository when the tab is pending or failed.
   */
  const hydrateTab = async (tab: RepoTab, seq: number) => {
    set({ activePath: tab.path });
    if (tab.status === "open" && tab.slice) {
      useRepoStore.getState().hydrate(tab.slice);
      persist();
      // A cached view is not disk truth — the branch may have moved, or another
      // process may have committed, since the tab was left.
      await useRepoStore.getState().refreshAll();
      return;
    }
    // Pending / failed / open-without-a-slice: clear first, so the previous
    // repository's data is not on screen while this one loads.
    useRepoStore.getState().hydrate({ ...emptySlice(), loading: true });
    persist();
    set({ activating: tab.path });
    let handle: RepoHandle | null = null;
    try {
      handle = await useRepoStore.getState().openRepoAt(tab.path);
    } finally {
      if (get().activating === tab.path) set({ activating: null });
    }
    if (!stillCurrent(seq)) {
      // Superseded mid-open (the user moved to another tab). Nobody will ever
      // use this handle, and `open` never evicts on its own — so evict it here
      // or it is a leaked git2::Repository for the rest of the session.
      if (handle) {
        void closeRepoIpc(handle.id).catch(() => {});
      }
      return;
    }
    if (!handle) {
      set((s) => ({ tabs: patchTab(s.tabs, tab.path, { status: "failed" }) }));
      persist();
      return;
    }
    // `open` returns the canonicalised workdir, which may differ from the path
    // we asked for. Re-key the tab onto it, dropping any tab that already had it.
    const resolved = handle.path;
    set((s) => {
      let tabs = s.tabs;
      if (resolved !== tab.path && indexOfTab(tabs, resolved) >= 0) {
        tabs = removeTab(tabs, tab.path);
        tabs = patchTab(tabs, resolved, {
          repoId: handle.id,
          status: "open",
          slice: null,
        });
      } else {
        tabs = patchTab(tabs, tab.path, {
          path: resolved,
          repoId: handle.id,
          status: "open",
          slice: null,
        });
      }
      return { tabs, activePath: resolved };
    });
    persist();
  };

  const evict = (tab: RepoTab | null) => {
    if (!tab?.repoId) return;
    void closeRepoIpc(tab.repoId).catch((e) => {
      // The tab is going away either way; a failed eviction is a leak, not a
      // thing to interrupt the user about.
      logWarn(`close_repo failed for ${tab.path}: ${describeError(e)}`);
    });
  };

  return {
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,

    async openRepo(path) {
      const existing = findTab(get().tabs, path);
      if (existing) {
        await get().activate(existing.path);
        return;
      }
      const seq = beginActivation();
      const outgoing = get().activePath;
      if (outgoing) snapshotInto(outgoing);
      // Create the tab optimistically so the strip shows where the work is
      // going; hydrateTab marks it `failed` (and keeps the outgoing tab's data
      // reachable) if the open is rejected.
      set((s) => ({ tabs: upsertTab(s.tabs, newTab(path)) }));
      const tab = findTab(get().tabs, path);
      if (!tab) return;
      await hydrateTab(tab, seq);
      // A failed open leaves no tab behind: the error banner already says what
      // happened, and an unopenable tab is a dead row the user must clean up.
      if (!stillCurrent(seq)) return;
      const after = findTab(get().tabs, path);
      if (after?.status === "failed") {
        const failure = useRepoStore.getState().error;
        await get().close(path);
        // `close` re-activates the tab we came from, whose `refreshAll` clears
        // `error` first — so the banner has to be restored LAST, exactly as the
        // store's own danger-op catch arms do it.
        if (failure) useRepoStore.getState().setError(failure);
      }
    },

    async activate(path) {
      const tab = findTab(get().tabs, path);
      if (!tab) return;
      // An open for this very tab is already in flight — a second one would
      // mint a second RepoId for the same repository and leak the loser.
      if (get().activating === path) return;
      // Already active AND actually loaded: nothing to do. The `current` check
      // is not redundant — it is the invariant. Without it, a tab the store no
      // longer holds (a store reset, a failed reopen) would look live and the
      // app would sit on an empty slice forever.
      if (
        get().activePath === path &&
        tab.status === "open" &&
        useRepoStore.getState().current?.id === tab.repoId
      ) {
        return;
      }
      const seq = beginActivation();
      const outgoing = get().activePath;
      if (outgoing && outgoing !== path) snapshotInto(outgoing);
      await hydrateTab(tab, seq);
    },

    async close(path) {
      const target = findTab(get().tabs, path);
      if (!target) return;
      // The resolver is a SEPARATE window driving IPC with this repository's
      // RepoId. Evicting it underneath would make the resolver's next call fail
      // with `UnknownRepo` in the middle of a conflict resolution — so ask here,
      // in the window the user is looking at, and close the resolver first if
      // they agree. Declining leaves the tab open: better than a half-broken
      // resolver.
      if (target.repoId && (await mergeWindowHoldsRepo(target.repoId))) {
        const go = await pgConfirm({
          title: "Close this repository and its merge resolver?",
          body:
            "The resolver window is open for this repository. Closing the tab " +
            "closes it too, and any side picks or result-pane edits not yet " +
            "applied are lost. The files stay conflicted on disk.",
          danger: true,
          confirmLabel: "Close both",
        });
        if (!go) return;
        await closeMergeWindow();
      }
      // Re-read: the confirm above is an await, and the strip may have moved.
      const tabs = get().tabs;
      const idx = indexOfTab(tabs, path);
      if (idx < 0) return;
      evict(tabs[idx]);
      const remaining = removeTab(tabs, path);
      const wasActive = get().activePath === path;
      if (!wasActive) {
        set({ tabs: remaining });
        persist();
        return;
      }
      const seq = beginActivation();
      const next = closeNeighbour(remaining, idx);
      set({ tabs: remaining, activePath: next?.path ?? null });
      persist();
      if (!next) {
        // Back to Welcome, exactly as "Close repo" always did.
        useRepoStore.getState().closeRepo();
        return;
      }
      await hydrateTab(next, seq);
    },

    async closeOthers(keepPath) {
      for (const t of get().tabs.filter((t) => t.path !== keepPath)) {
        await get().close(t.path);
      }
      await get().activate(keepPath);
    },

    async closeAll() {
      for (const t of [...get().tabs]) {
        await get().close(t.path);
      }
    },

    async step(delta) {
      const next = cycle(get().tabs, get().activePath, delta);
      if (next) await get().activate(next);
    },

    async selectIndex(oneBased) {
      const tab = get().tabs[oneBased - 1];
      if (tab) await get().activate(tab.path);
    },

    rememberScreen(screen) {
      const path = get().activePath;
      if (!path) return;
      set((s) => ({ tabs: patchTab(s.tabs, path, { screen }) }));
    },

    activeScreen() {
      return findTab(get().tabs, get().activePath)?.screen ?? null;
    },

    async refreshBadges() {
      const active = get().activePath;
      const targets = get().tabs.filter(
        (t) => t.path !== active && t.status === "open" && t.repoId,
      );
      await Promise.all(
        targets.map(async (t) => {
          try {
            const status = await getStatus(t.repoId as string);
            set((s) => ({
              tabs: patchTab(s.tabs, t.path, {
                dirty: status.filter((f) => isStaged(f) || isUnstaged(f)).length,
                conflicts: status.filter(isConflicted).length,
                // Keep the frozen slice consistent with the badge, so coming
                // back to the tab doesn't briefly contradict its own dot.
                slice: s.tabs.find((x) => x.path === t.path)?.slice
                  ? { ...(s.tabs.find((x) => x.path === t.path)!.slice as RepoSlice), status }
                  : null,
              }),
            }));
          } catch {
            // A background badge is not worth an error banner.
          }
        }),
      );
    },

    async restoreSession() {
      if (get().tabs.length > 0) return;
      const { paths, active } = loadOpenRepos();
      if (paths.length === 0) return;
      set({ tabs: paths.map((p) => newTab(p)) });
      const target = active ?? paths[0];
      // Lazy on purpose: five persisted repositories cost ONE open at launch,
      // not five. The rest open when first activated.
      await get().activate(target);
    },

    labels() {
      return labelTabs(get().tabs);
    },
  };
});
