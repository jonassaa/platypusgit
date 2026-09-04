import React from "react";

import { takeLaunchIntent } from "@/lib/tauri";
import type { LaunchIntent } from "@/lib/types";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { isPrimaryWindow, listenToThisWindow } from "@/features/windows";

async function handleIntent(intent: LaunchIntent | null): Promise<void> {
  if (!intent) return;
  if (intent.path) {
    // Opens a TAB (#90): a forwarded `pgit ~/other-repo` from a second
    // terminal focuses that repository's existing tab or adds one — it no
    // longer evicts whatever the user was looking at. A failed open surfaces
    // the normal error banner; the screen switch below is harmless alongside it.
    await useTabsStore.getState().openRepo(intent.path);
  }
  if (intent.screen) {
    useNavStore.getState().setIntent({
      kind: "switch-screen",
      screen: intent.screen,
    });
  }
}

/**
 * CLI launch plumbing, mounted once per window in AppShell. Pulls the
 * first-launch intent (take-once command), then listens for `cli-launch`
 * events forwarded by the single-instance plugin when the user runs `pgit …`
 * again.
 *
 * Two things are scoped to a single window since #256. The first-launch intent
 * is taken by the PRIMARY window only: `take_launch_intent` is take-once, so
 * with several windows racing to mount, `pgit ~/repo` would land in whichever
 * one happened to ask first — a restored window on the second monitor, as
 * often as the one in front of the user. And the forwarded event is no longer
 * a broadcast: the backend routes it to the window that already has that
 * repository open, else the last-focused one, so this listener fires in exactly
 * one window (`src-tauri/src/windows.rs`).
 */
export function useCliLaunch(): void {
  React.useEffect(() => {
    if (isPrimaryWindow()) void takeLaunchIntent().then(handleIntent);
    // Scoped to THIS window, not a plain `listen`: an untargeted listener
    // matches every emit, so the backend's routing would be undone here and
    // every window would open the forwarded repository. See
    // `features/windows/windowEvents.ts`.
    const unlisten = listenToThisWindow<LaunchIntent>("cli-launch", (e) => {
      void handleIntent(e.payload);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);
}
