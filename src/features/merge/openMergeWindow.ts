// Opens (or focuses) the single merge resolver window. The window fetches its
// own data over IPC; the only cross-window state is events.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { useRepoStore } from "@/features/repo/useRepoStore";

export async function openMergeWindow(repoId: string, path: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel("merge");
  if (existing) {
    await emit("merge://open-file", { repoId, path });
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow("merge", {
    url: `/?window=merge&repoId=${encodeURIComponent(repoId)}&path=${encodeURIComponent(path)}`,
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 500,
    title: `Resolve: ${path}`,
  });
  // Any exit path (Apply-through-last-file, Esc, OS close button) must leave
  // the main window showing disk truth.
  void win.once("tauri://destroyed", () => {
    void useRepoStore.getState().refreshAll();
  });
  void win.once("tauri://error", (e) => {
    console.error("merge window failed to open", e);
  });
}
