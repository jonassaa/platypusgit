import type React from "react";
import type { IconName } from "@/design";

export type SettingsGroupId = "general" | "git" | "advanced";

export type SettingsPageId =
  | "general.appearance"
  | "general.keyboard"
  | "general.updates"
  | "git.commit"
  | "git.diff"
  | "git.remote"
  | "git.integrations"
  | "advanced.cli"
  | "advanced.workspace"
  | "advanced.backup";

/**
 * `SettingsPageId`s in side-menu display order.
 *
 * A duplicate of `pages.ts`'s `GROUPS`-derived `PAGE_ORDER`, kept ONLY so
 * `FIRST_PAGE` and `resolvePageId` can live here too — see the note on those
 * below for why. `pages.ts`'s `PAGE_ORDER` (and `GROUPS`, which the guard
 * test in `settings.index.test.tsx` cross-checks against it) stays the one
 * source of truth for the actual menu; this list only has to agree with it —
 * both in members AND in order, since a `GROUPS` reorder that left this list
 * behind would disagree with the side menu's first row about what "the first
 * page" is. `settings.index.test.tsx`'s order guard pins full agreement;
 * `useSettingsStore.export.test.ts`'s "defaults to the first page" test pins
 * the one entry that matters most. Exported for that guard test only — every
 * other importer wants `FIRST_PAGE` or `resolvePageId`, not the list itself.
 */
export const PAGE_ORDER: readonly SettingsPageId[] = [
  "general.appearance",
  "general.keyboard",
  "general.updates",
  "git.commit",
  "git.diff",
  "git.remote",
  "git.integrations",
  "advanced.cli",
  "advanced.workspace",
  "advanced.backup",
];

/**
 * First page of the first group. The `settingsPage` default, and the
 * fallback for an unresolvable page id.
 *
 * Lives here rather than in `pages.ts`, and this file imports nothing from
 * the feature, on purpose: `pages.ts` imports all ten page modules, and those
 * import `useSettingsStore` — so `useSettingsStore` importing `FIRST_PAGE`
 * FROM `pages.ts` would be a real cycle (confirmed: it crashed
 * `pages.ts`'s own module-load loop over `PAGES`, since a page module
 * mid-load through the cycle has no `meta` yet). `pages.ts` re-exports both
 * names so existing importers of it keep working; `useSettingsStore` imports
 * straight from here instead, since importing THROUGH `pages.ts` would still
 * pull in the ten page modules and reopen the same cycle.
 */
export const FIRST_PAGE: SettingsPageId = PAGE_ORDER[0];

/**
 * Coerce a persisted or deep-linked page id.
 *
 * `coerceSettings`' scalar guard compares against `typeof DEFAULTS[key]` and so
 * waves through ANY string, and a deep link can name a page a later build
 * removed. Resolving here rather than trusting the caller is the same
 * defensive shape as `normalizeThemePreference`'s "an unknown mode reads as
 * fixed".
 */
export function resolvePageId(raw: unknown): SettingsPageId {
  return typeof raw === "string" && (PAGE_ORDER as readonly string[]).includes(raw)
    ? (raw as SettingsPageId)
    : FIRST_PAGE;
}

/**
 * A condition under which a row exists at all.
 *
 * `"updatable"` is the only one, and it is not cosmetic: on a Microsoft Store
 * install `UpdatesPage` renders no check and no channel, because
 * `StoreManaged` gates the CHECK and not just the install — Store policy 10.2.5
 * makes *notifying* the violation, and v0.4.0 failed certification on it. The
 * search index is a new surface that reads `UpdateCapability`, so it gates on
 * the same `updatesManagedExternally` predicate the card already uses.
 */
export type SettingRowGate = "updatable";

export interface SettingRowMeta {
  /** Unique app-wide. Rendered as `data-setting-id`. */
  id: string;
  /** Must equal the rendered `SettingsRow`'s `label` — the guard test enforces it. */
  label: string;
  /**
   * Synonyms the label does not contain.
   *
   * `SettingsRow`'s `hint` is a `React.ReactNode` and cannot be flattened to
   * text reliably, so hints are NOT indexed. Any word that lives only in a hint
   * but matters for discovery — "GPG", "SSH", "fish", "pwsh", "difftool" —
   * belongs here. This is the one convention the guard test cannot check.
   */
  keywords?: string;
  /** Absent from the index and the DOM unless the gate is satisfied. */
  when?: SettingRowGate;
}

export interface SettingCardMeta {
  id: string;
  title: string;
  subtitle?: string;
  rows: SettingRowMeta[];
  /**
   * The card renders content search cannot index per-row — a data-driven list.
   * It renders IN FULL whenever any of its declared rows match, and the guard
   * test exempts it from the both-directions DOM check.
   */
  dynamic?: boolean;
}

export interface SettingsPageMeta {
  id: SettingsPageId;
  group: SettingsGroupId;
  title: string;
  icon: IconName;
  cards: SettingCardMeta[];
}

export interface SettingsPageModule {
  meta: SettingsPageMeta;
  Page: React.ComponentType;
}
