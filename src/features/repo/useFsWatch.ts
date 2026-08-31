// Keep the working copy live (#239).
//
// Two effects with different lifetimes, and keeping them apart is the point:
//
//   1. The SUBSCRIPTION is app-global and mounted once, like `net://progress`.
//      Re-subscribing per repository would open a window on every tab switch
//      where events are silently dropped.
//   2. The WATCH follows the active repository and the setting. Starting it is
//      a swap on the backend, so a tab switch needs no matching stop.

import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { watchRepo, watchStop } from "@/lib/tauri";
import type { FsChange } from "@/lib/types";

import { fsRefreshPlan, mergeRefresh, type FsRefresh } from "./fsWatchPlan";
import { useRepoStore } from "./useRepoStore";

/**
 * Subscribe to `fs://changed` and refresh what it asks for.
 *
 * Mounted once from `AppShell`.
 */
export function useFsWatch(repoId: string | null): void {
  const enabled = useSettingsStore((s) => s.watchFilesystem);

  // A refresh in flight, and what to run after it. Refs rather than state:
  // these coordinate async work and must never cause a render of their own —
  // a re-render here would remount nothing but would re-run the effect below
  // and churn the backend watch.
  const running = React.useRef(false);
  const pending = React.useRef<FsRefresh>("none");

  const run = React.useCallback(async (what: FsRefresh) => {
    if (what === "none") return;
    if (running.current) {
      // Coalesce rather than queue. A burst produces at most one more refresh
      // after the current one, and `mergeRefresh` keeps it from downgrading a
      // pending log refresh to a status-only one.
      pending.current = mergeRefresh(pending.current, what);
      return;
    }
    running.current = true;
    try {
      const store = useRepoStore.getState();
      if (what === "all") await store.refreshAll();
      else await store.refreshStatus();
    } catch {
      // A background refresh must not raise a banner. The user did not ask for
      // this one, and whatever is wrong will surface loudly the moment they do
      // ask for something — with an error that names an action they took.
    } finally {
      running.current = false;
      const next = pending.current;
      pending.current = "none";
      if (next !== "none") void run(next);
    }
  }, []);

  // 1. The subscription — once, for the app's lifetime.
  React.useEffect(() => {
    const sub = listen<FsChange>("fs://changed", (e) => {
      const s = useRepoStore.getState();
      void run(
        fsRefreshPlan({
          change: e.payload,
          currentRepoId: s.current?.id ?? null,
          // `activity` is what the status line and the Cancel button are
          // driven from, so "the app is doing something" and "do not refresh
          // under it" cannot drift apart.
          busy: Object.keys(s.activity).length > 0,
          enabled: useSettingsStore.getState().watchFilesystem,
        }),
      );
    });
    return () => {
      void sub.then((un) => un()).catch(() => {});
    };
  }, [run]);

  // 2. The watch itself — follows the repository and the setting.
  React.useEffect(() => {
    if (!enabled || !repoId) {
      // Stopping unconditionally rather than only when one was started: this
      // also covers the setting being switched off, and `watch_stop` is
      // idempotent precisely so the caller does not have to track that.
      void watchStop().catch(() => {});
      return;
    }
    void watchRepo(repoId).catch(() => {
      // A watch that cannot start is a degradation, not a failure — the app is
      // still correct, just not live. The backend has already logged why.
    });
    return () => {
      void watchStop().catch(() => {});
    };
  }, [enabled, repoId]);
}
