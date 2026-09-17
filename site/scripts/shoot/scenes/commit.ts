// commit-dark — the working tree, staged split, diff and commit composer.
//
// Same repository as the history figure; what differs is the screen and the
// diff view mode. The app always launches on History, so this one navigates the
// way a user does — clicking the activity bar, then the file row — rather than
// being seeded into place. See Scene.afterMount.
import type { Scene } from "../shim/core";
import { clickWhenPresent, clickByText } from "../shim/core";
import { BOOT_HANDLERS, settingsStorage } from "./shared";
import { SHOWCASE_PATH, showcaseHandlers } from "../fixtures/showcase";

/** The row the figure shows the diff of. Must be a path in STATUS. */
const SELECTED = "src/engine.ts";

export const commit: Scene = {
  name: "commit",
  figure: "commit-dark",
  now: "2026-07-28T10:30:00+02:00",
  storage: {
    // Note there is no diff-view-mode setting here: the commit panel's
    // Unified/Split toggle is LOCAL React state defaulting to unified
    // (CommitPanel.tsx), not the `diffViewMode` setting — that one drives the
    // standalone DiffViewer. So this figure clicks it, below.
    "pg-settings-v2": settingsStorage(),
    "pg-open-repos": JSON.stringify({
      paths: [SHOWCASE_PATH],
      active: SHOWCASE_PATH,
    }),
  },
  handlers: { ...BOOT_HANDLERS, ...showcaseHandlers() },
  afterMount: async () => {
    await clickWhenPresent('[data-activity="commit"]');
    // Select the file whose diff this figure is about. Without this the list
    // selects its first row (NOTES.md) and the figure shows one file's name
    // over another file's diff.
    await clickWhenPresent(`[data-path="${SELECTED}"]`);
    // Two columns, as the approved composition shows.
    await clickByText("button", "Split");
  },
};
