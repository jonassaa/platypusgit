// Palette steps shared beyond commands.ts — the keymap's default runners push
// these directly (e.g. ⌘N → create-branch input step), so they live in a
// module with no keymap imports to keep the dependency graph acyclic.

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { labelTabs, repoDisplayName } from "@/features/repo/tabs";
import { usePaletteStore } from "./usePaletteStore";
import type { PaletteItem, PaletteStep } from "./types";

/** The "Create branch" input step — used by the palette command and ⌘N. */
export function createBranchInputStep(): PaletteStep {
  return {
    kind: "input",
    title: "Create branch",
    placeholder: "new-branch-name",
    validate: (v) => (v.trim() ? null : "Branch name required"),
    onSubmit: (v) => {
      usePaletteStore.getState().closePalette();
      void useRepoStore
        .getState()
        .createAndSwitchBranch(v.trim(), { autoStash: true });
    },
  };
}

/**
 * The "Switch repository" pick step — used by the palette command and ⌘E.
 *
 * Lists every OPEN tab first, then the recents that are not open (which open in
 * a new tab when picked). The second half matters beyond convenience: it is the
 * only keyboard-reachable way to open another repository without the native
 * folder dialog.
 */
export function switchRepoStep(): PaletteStep {
  const { tabs, activePath } = useTabsStore.getState();
  const openPaths = new Set(tabs.map((t) => t.path));
  const labels = labelTabs(tabs);
  const items: PaletteItem[] = tabs.map((t, i) => ({
    type: "command" as const,
    id: `repo-tab:${t.path}`,
    search: `${labels[i]} ${t.path}`,
    label: labels[i],
    detail: t.path === activePath ? "current" : t.path,
    icon: "repo",
    run: () => {
      usePaletteStore.getState().closePalette();
      void useTabsStore.getState().activate(t.path);
    },
  }));
  for (const r of useRecentsStore.getState().recents) {
    if (openPaths.has(r.path)) continue;
    items.push({
      type: "command" as const,
      id: `repo-recent:${r.path}`,
      search: `${repoDisplayName(r.path)} ${r.path} open recent`,
      label: repoDisplayName(r.path),
      detail: r.path,
      icon: "folder",
      run: () => {
        usePaletteStore.getState().closePalette();
        void useTabsStore.getState().openRepo(r.path);
      },
    });
  }
  return { kind: "pick", title: "Switch repository", items };
}
