import React from "react";
import { listen } from "@tauri-apps/api/event";

import { takeLaunchIntent } from "@/lib/tauri";
import type { LaunchIntent } from "@/lib/types";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useNavStore } from "@/features/nav/useNavStore";

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
 * CLI launch plumbing, mounted once in AppShell. Pulls the first-launch
 * intent (take-once command), then listens for `cli-launch` events forwarded
 * by the single-instance plugin when the user runs `pgit …` again.
 */
export function useCliLaunch(): void {
  React.useEffect(() => {
    void takeLaunchIntent().then(handleIntent);
    const unlisten = listen<LaunchIntent>("cli-launch", (e) => {
      void handleIntent(e.payload);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);
}
