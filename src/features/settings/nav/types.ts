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
 * A condition under which a row exists at all.
 *
 * `"updatable"` is the only one, and it is not cosmetic: on a Microsoft Store
 * install `UpdatesSection` renders no check and no channel, because
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
