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
// Four guards keep concurrency honest, and #177 is what each of the last three
// costs when it is missing:
//   - `activationSeq` — bumped on every activate/open, re-checked after each
//     await, so a session restore racing a forwarded CLI launch cannot both win.
//   - `useRepoStore`'s own `setFor`, which drops a fetch that resolved after the
//     user moved on.
//   - `repoPathKey` (tabs.ts) — path identity, so two producers spelling one
//     workdir differently cannot open the repository twice.
//   - the `stillWanted` predicate handed to `openRepoAt`, re-asked at the moment
//     the open resolves: a switch to an already-open tab supersedes an in-flight
//     open without starting one, which the repo store cannot see for itself.

import { create } from "zustand";

import { pgConfirm } from "@/design";
import {
  closeMergeWindow,
  mergeWindowHoldsRepo,
} from "@/features/merge/openMergeWindow";
import {
  closeRepo as closeRepoIpc,
  getStatus,
  registerWindowRepos,
  termClose,
} from "@/lib/tauri";
import { openAppWindow, openReposKey, windowLabel } from "@/features/windows";
import { useTerminalStore } from "@/features/terminal/useTerminalStore";
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
  moveTab,
  newTab,
  patchTab,
  removeTab,
  repoPathKey,
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
   *
   * "Already open" is decided on the NORMALIZED path (`repoPathKey`), so two
   * producers spelling one repository differently — a restored `pg-open-repos`
   * entry and a `pgit <path>` launch intent, say — focus one tab instead of
   * opening the repository twice (#177).
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
  /** Move the tab at `from` to index `to`, persisting the new order (#238). */
  reorder: (from: number, to: number) => void;
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
  /**
   * Open `path` in a NEW window (#256), leaving this window as it is.
   *
   * Tabs are for switching, windows are for comparing — this is the second
   * half. The new window opens its own `RepoId` for the repository, so the two
   * windows share nothing that one could break for the other.
   */
  openInNewWindow: (path: string) => Promise<void>;
  /** Same, but the tab leaves this window. */
  moveTabToNewWindow: (path: string) => Promise<void>;
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
  /**
   * Which storage key this window's open set lives under (#256). Read once —
   * a window's label cannot change — and `main` still writes the bare
   * `pg-open-repos` it has written since #90, so an upgrading user's session
   * restores exactly as before.
   */
  const storageKey = openReposKey(windowLabel());

  const persist = () => {
    saveOpenRepos(get().tabs, get().activePath, storageKey);
    // The backend half of the same write. It answers two questions no webview
    // can answer about another window: where a forwarded `pgit <path>` should
    // land, and what to evict when this window is closed. Fire-and-forget —
    // a registry that is one write behind costs a mis-routed launch, which is
    // not worth failing a tab switch over.
    void registerWindowRepos(
      get().tabs.map((t) => ({ id: t.repoId, path: t.path })),
    ).catch(() => {});
  };

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
      // The predicate is re-asked at the moment the open resolves, before the
      // repo store adopts it: a switch to an ALREADY-OPEN tab supersedes this
      // open without starting one of its own, so the store cannot see that for
      // itself and would otherwise make this handle `current` after the winner
      // had already hydrated (#177). It then closes the handle and answers null.
      handle = await useRepoStore
        .getState()
        .openRepoAt(tab.path, () => stillCurrent(seq));
    } finally {
      if (get().activating === tab.path) set({ activating: null });
    }
    if (!stillCurrent(seq)) {
      // Superseded AFTER the adoption (the refresh inside the open is awaited,
      // so the user can move on during it). `current` has since been overwritten
      // by whoever superseded us, so the handle is unreachable — and `open`
      // never evicts on its own, so evict it here or it is a leaked
      // git2::Repository for the rest of the session.
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
    // That drop is where the LAST orphan lived. `repoPathKey` settles every
    // spelling the frontend can settle, but only the backend can resolve a
    // symlinked one (`/var/x` → `/private/var/x` on macOS), so two tabs can still
    // exist for one repository — and re-keying used to overwrite the surviving
    // tab's `repoId` with this one, abandoning a `git2::Repository` for the rest
    // of the process. Evict it: this is the "close the loser when the duplicate
    // open could not be prevented" case, and it is the only one left.
    const displaced = resolved === tab.path ? null : findTab(get().tabs, resolved);
    if (displaced?.repoId && displaced.repoId !== handle.id) evict(displaced);
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
    // The shell belongs to the tab (#243). Done HERE rather than in `close` so
    // every eviction route is covered — `closeOthers` and `closeAll` delegate
    // to `close`, but the displaced-tab path at the LRU cap does not, and an
    // orphaned interactive shell is invisible except in a process list.
    // `term_close` is idempotent, so a tab that never opened a terminal costs
    // one no-op invoke.
    void termClose(tab.repoId).catch((e) => {
      logWarn(`term_close failed for ${tab.path}: ${describeError(e)}`);
    });
    useTerminalStore.getState().forget(tab.repoId);
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
      // Every comparison below is against `tab.path`, the NORMALIZED key, never
      // the caller's spelling of it: `findTab` normalizes, so a caller holding
      // `/repo/` finds the tab and then slipped past both guards (#177). The
      // first of them is what keeps the launch race down to one open.
      //
      // An open for this very tab is already in flight — a second one would
      // mint a second RepoId for the same repository and leak the loser.
      if (get().activating === tab.path) return;
      // Already active AND actually loaded: nothing to do. The `current` check
      // is not redundant — it is the invariant. Without it, a tab the store no
      // longer holds (a store reset, a failed reopen) would look live and the
      // app would sit on an empty slice forever.
      if (
        get().activePath === tab.path &&
        tab.status === "open" &&
        useRepoStore.getState().current?.id === tab.repoId
      ) {
        return;
      }
      const seq = beginActivation();
      const outgoing = get().activePath;
      if (outgoing && outgoing !== tab.path) snapshotInto(outgoing);
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
      // Keyed on `target.path` throughout, for the reason `activate` gives:
      // `openRepo`'s failed-open cleanup forwards its RAW argument here, so a
      // `/repo/` would have been removed from the strip while `activePath` went
      // on naming it — leaving the store on a repository this call just evicted.
      const tabs = get().tabs;
      const idx = indexOfTab(tabs, target.path);
      if (idx < 0) return;
      evict(tabs[idx]);
      const remaining = removeTab(tabs, target.path);
      const wasActive = get().activePath === target.path;
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
      // Normalized first: an unnormalized spelling matches no tab, so the filter
      // kept nothing and this closed the repository it was asked to keep (#177).
      const keep = repoPathKey(keepPath);
      for (const t of get().tabs.filter((t) => t.path !== keep)) {
        await get().close(t.path);
      }
      await get().activate(keep);
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

    reorder(from, to) {
      const next = moveTab(get().tabs, from, to);
      // `moveTab` returns the input array for a move that changes nothing, so a
      // drag that lands where it started, or an out-of-range index, costs no
      // re-render and no localStorage write.
      if (next === get().tabs) return;
      set({ tabs: next });
      // Reordering never activates: the live repository must not change under a
      // drag, and `saveOpenRepos` re-reads `activePath` unchanged.
      persist();
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
      const { paths, active } = loadOpenRepos(storageKey);
      if (paths.length === 0) return;
      set({ tabs: paths.map((p) => newTab(p)) });
      const target = active ?? paths[0];
      // Lazy on purpose: five persisted repositories cost ONE open at launch,
      // not five. The rest open when first activated.
      await get().activate(target);
    },

    async openInNewWindow(path) {
      const tab = findTab(get().tabs, path);
      await openAppWindow({ seedPaths: [tab?.path ?? path] });
    },

    async moveTabToNewWindow(path) {
      const tab = findTab(get().tabs, path);
      if (!tab) return;
      const label = await openAppWindow({ seedPaths: [tab.path] });
      // Only close the tab once the window it is moving to actually exists.
      // A failed creation that had already closed the tab would lose the
      // repository from both windows — the one place in this store where a
      // failure could take work away rather than leave it where it was.
      if (!label) return;
      await get().close(tab.path);
    },

    labels() {
      return labelTabs(get().tabs);
    },
  };
});
