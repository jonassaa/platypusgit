// Opens (or focuses) the single merge resolver window. The window fetches its
// own data over IPC; the only cross-window state is events.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { useRepoStore } from "@/features/repo/useRepoStore";

/**
 * `path` is optional: the operation bar, the status-bar count and the
 * `conflict.openResolver` chord all open the resolver on the repository rather
 * than on one file (#108), and the window then picks the first unresolved file
 * from its own list. A path is passed only when the user named a file.
 */
export async function openMergeWindow(repoId: string, path?: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel("merge");
  if (existing) {
    // A null path retargets the window to the repository without stealing the
    // file the user is in the middle of — see MergeWindow's listener.
    await emit("merge://open-file", { repoId, path: path ?? null });
    await existing.setFocus();
    return;
  }
  const params = new URLSearchParams({ window: "merge", repoId });
  if (path) params.set("path", path);
  const win = new WebviewWindow("merge", {
    url: `/?${params.toString()}`,
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 500,
    title: path ? `Resolve: ${path}` : "Resolve conflicts",
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
