// Palette steps shared beyond commands.ts — the keymap's default runners push
// these directly (e.g. ⌘N → create-branch input step), so they live in a
// module with no keymap imports to keep the dependency graph acyclic.

import { useRepoStore } from "@/features/repo/useRepoStore";
import { usePaletteStore } from "./usePaletteStore";
import type { PaletteStep } from "./types";

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
