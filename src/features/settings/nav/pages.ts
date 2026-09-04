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
import type {
  SettingsGroupId,
  SettingsPageId,
  SettingsPageModule,
} from "./types";

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

/** First page of the first group. The `settingsPage` default, and the fallback. */
export const FIRST_PAGE: SettingsPageId = PAGE_ORDER[0];

/**
 * Coerce a persisted or deep-linked page id.
 *
 * `coerceSettings`' scalar guard compares against `typeof DEFAULTS[key]` and so
 * waves through ANY string, and a deep link can name a page a later build
 * removed. Resolving here rather than trusting the caller is the same defensive
 * shape as `normalizeThemePreference`'s "an unknown mode reads as fixed".
 */
export function resolvePageId(raw: unknown): SettingsPageId {
  return typeof raw === "string" && (PAGE_ORDER as readonly string[]).includes(raw)
    ? (raw as SettingsPageId)
    : FIRST_PAGE;
}

// Hand the layout pair each card's declared rows, so a card can decide whether
// it is empty before its children render. Runs once, at module load.
for (const pageId of Object.keys(PAGES) as SettingsPageId[]) {
  for (const card of PAGES[pageId].meta.cards) {
    registerCardRows(card.id, card.rows.map((r) => r.id));
  }
}
