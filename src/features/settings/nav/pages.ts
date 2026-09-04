import { registerCardRows } from "@/features/settings/layout/SettingsCard";
import * as appearance from "@/features/settings/pages/appearance";
import * as backup from "@/features/settings/pages/backup";
import * as cli from "@/features/settings/pages/cli";
import * as commit from "@/features/settings/pages/commit";
import * as diff from "@/features/settings/pages/diff";
import * as integrations from "@/features/settings/pages/integrations";
import * as keyboard from "@/features/settings/pages/keyboard";
import * as remote from "@/features/settings/pages/remote";
import * as updates from "@/features/settings/pages/updates";
import * as workspace from "@/features/settings/pages/workspace";
import { FIRST_PAGE, resolvePageId } from "./types";
import type {
  SettingsGroupId,
  SettingsPageId,
  SettingsPageModule,
} from "./types";

// Re-exported so existing importers of this module keep working. Both are
// DEFINED in `./types` rather than here — see that file's comment on
// `FIRST_PAGE` for why: this module imports all ten page modules, which
// import `useSettingsStore`, so `useSettingsStore` importing `FIRST_PAGE`
// FROM HERE would be a real cycle. `useSettingsStore` imports straight from
// `./types` instead; this re-export is for everyone else.
export { FIRST_PAGE, resolvePageId };

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  pages: readonly SettingsPageId[];
}

/**
 * The side menu, in display order.
 *
 * Groups are declared here and not derived from the pages, because ORDER is a
 * design decision and a derived list would silently reorder when a page moved
 * file. The guard test cross-checks the two against each other.
 */
export const GROUPS: readonly SettingsGroup[] = [
  { id: "general", title: "General", pages: ["general.appearance", "general.keyboard", "general.updates"] },
  { id: "git", title: "Git", pages: ["git.commit", "git.diff", "git.remote", "git.integrations"] },
  { id: "advanced", title: "Advanced", pages: ["advanced.cli", "advanced.workspace", "advanced.backup"] },
];

export const PAGES: Record<SettingsPageId, SettingsPageModule> = {
  "general.appearance": { meta: appearance.meta, Page: appearance.AppearancePage },
  "general.keyboard": { meta: keyboard.meta, Page: keyboard.KeyboardPage },
  "general.updates": { meta: updates.meta, Page: updates.UpdatesPage },
  "git.commit": { meta: commit.meta, Page: commit.CommitPage },
  "git.diff": { meta: diff.meta, Page: diff.DiffPage },
  "git.remote": { meta: remote.meta, Page: remote.RemotePage },
  "git.integrations": { meta: integrations.meta, Page: integrations.IntegrationsPage },
  "advanced.cli": { meta: cli.meta, Page: cli.CliPage },
  "advanced.workspace": { meta: workspace.meta, Page: workspace.WorkspacePage },
  "advanced.backup": { meta: backup.meta, Page: backup.BackupPage },
};

export const PAGE_ORDER: readonly SettingsPageId[] = GROUPS.flatMap((g) => g.pages);

// Hand the layout pair each card's declared rows, so a card can decide whether
// it is empty before its children render. Runs once, at module load.
for (const pageId of Object.keys(PAGES) as SettingsPageId[]) {
  for (const card of PAGES[pageId].meta.cards) {
    registerCardRows(card.id, card.rows.map((r) => r.id));
  }
}
