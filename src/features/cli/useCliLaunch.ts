import React from "react";
import { listen } from "@tauri-apps/api/event";

import { takeLaunchIntent } from "@/lib/tauri";
import type { LaunchIntent } from "@/lib/types";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";

async function handleIntent(intent: LaunchIntent | null): Promise<void> {
  if (!intent) return;
  if (intent.path) {
    // A failed open surfaces the normal error banner; the screen switch
    // below is harmless alongside it.
    await useRepoStore.getState().openRepo(intent.path);
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
