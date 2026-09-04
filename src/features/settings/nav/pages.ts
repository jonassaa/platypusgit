import { registerCardRows } from "@/features/settings/layout/SettingsCard";
import * as appearance from "@/features/settings/pages/appearance";
import * as diff from "@/features/settings/pages/diff";
import * as keyboard from "@/features/settings/pages/keyboard";
import * as updates from "@/features/settings/pages/updates";
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
  "git.diff": { meta: diff.meta, Page: diff.DiffPage },
  // Task 6 adds the other six. Until then the mapped type below fails to
  // compile, which is the point: a missing page cannot be forgotten.
  //
  // The double cast (via `unknown`) is needed because TS's excess-property
  // check refuses a direct cast from an object with 4 of 10 keys straight to
  // `Record<SettingsPageId, …>` — "insufficient overlap". Scaffolding only:
  // Task 6 replaces this whole expression with a plain typed literal once all
  // ten keys are present, at which point the cast is not just unneeded but
  // would defeat the exhaustiveness the type exists to provide.
} as unknown as Record<SettingsPageId, SettingsPageModule>;

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
