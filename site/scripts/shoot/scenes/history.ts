// history-dark — the hero on the site's landing page.
//
// Content is the shipped 2026-08-18 figure's, reproduced: that composition was
// already approved, and keeping it makes the new figure directly comparable.
// What changes is the UI drawing it, which is the point.
//
// Launch always lands on History (AppShell: the old pg-screen restore is gone),
// so this scene only has to say which repository is open.
import type { Scene } from "../shim/core";
import { BOOT_HANDLERS, settingsStorage } from "./shared";
import { SHOWCASE_PATH, showcaseHandlers } from "../fixtures/showcase";

export const history: Scene = {
  name: "history",
  figure: "history-dark",
  // The showcase repository's commits are pinned to 2026-06-26. A month later
  // is what makes the age column read "1mo ago" / "2mo ago", as in the
  // approved composition.
  now: "2026-07-28T10:30:00+02:00",
  storage: {
    "pg-settings-v2": settingsStorage(),
    // `{ paths, active }` — the shape tabs.ts::loadOpenRepos reads.
    "pg-open-repos": JSON.stringify({
      paths: [SHOWCASE_PATH],
      active: SHOWCASE_PATH,
    }),
  },
  handlers: { ...BOOT_HANDLERS, ...showcaseHandlers() },
};
