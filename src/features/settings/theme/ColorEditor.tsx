import React from "react";

import { PGColorSwatch, type ColorSwatchOption } from "@/design";
import {
  THEME_COLOR_FIELDS,
  useSettingsStore,
  type ThemeColors,
} from "@/features/settings/useSettingsStore";
import { normalizeHex } from "@/lib/color";

import { CONTRAST_PAIRS } from "./contrast";

export function ColorEditor({
  colors,
  onPatch,
  badgeFor,
}: {
  colors: ThemeColors;
  onPatch: (p: Partial<ThemeColors>) => void;
  /**
   * Optional trailing content per field — the editor passes a contrast ratio
   * for the pairs `CONTRAST_PAIRS` names, so a finding is visible where the
   * colour is edited and not only in the summary under the preview.
   */
  badgeFor?: (key: keyof ThemeColors) => React.ReactNode;
}) {
  const groups: Array<{
    title: string;
    group: "background" | "foreground" | "border" | "accent" | "logo";
  }> = [
    { title: "Backgrounds", group: "background" },
    { title: "Text", group: "foreground" },
    { title: "Borders", group: "border" },
    { title: "Accent", group: "accent" },
    { title: "Logo", group: "logo" },
  ];

  return (
    <div style={{ padding: "14px 16px 18px" }}>
      {groups.map((g) => (
        <div key={g.group} style={{ marginTop: g.group === "background" ? 0 : 16 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-10)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--fg-2)",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {g.title}
          </div>
          <div
            style={{
              display: "grid",
              // 190px, not 240: the editor's left column is ~410px, so a 240px
              // minimum fitted exactly ONE field per row and made the list
              // twice as long to scroll as it needs to be.
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 8,
            }}
          >
            {THEME_COLOR_FIELDS.filter((f) => f.group === g.group).map((f) => (
              <ColorField
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={colors[f.key]}
                onChange={(v) =>
                  onPatch({ [f.key]: v } as Partial<ThemeColors>)
                }
                badge={badgeFor?.(f.key)}
                palette={colors}
                slot={f.key}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ColorField({
  label,
  hint,
  value,
  onChange,
  badge,
  palette,
  slot,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  badge?: React.ReactNode;
  /**
   * The whole draft, offered inside the picker as swatches.
   *
   * "Make the border match the panel" is the most-used move in here, and
   * without it that means reading a hex off one row and typing it into another.
   */
  palette?: ThemeColors;
  /** Which slot this edits, for the picker's contrast partner. */
  slot?: keyof ThemeColors;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const recentColors = useSettingsStore((s) => s.recentColors);
  const pushRecentColor = useSettingsStore((s) => s.pushRecentColor);

  const commitHex = (v: string) => {
    const normalized = normalizeHex(v);
    if (!normalized) return;
    onChange(normalized);
  };

  const swatches: ColorSwatchOption[] | undefined = palette
    ? THEME_COLOR_FIELDS.map((f) => ({ hex: palette[f.key], label: f.label }))
    : undefined;

  const contrast = slot ? contrastPartner(slot, palette) : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-1)",
      }}
      title={hint}
    >
      <PGColorSwatch
        label={label}
        value={value}
        onChange={onChange}
        onCommit={pushRecentColor}
        swatches={swatches}
        recent={recentColors}
        contrast={contrast ?? undefined}
        title={hint}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div style={{ marginTop: 2 }}>
          <input
            // The field's accessible name, so a test (and a screen reader)
            // can reach "Background · base" rather than an unlabelled box.
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitHex(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitHex(draft);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setDraft(value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              padding: 0,
            }}
          />
        </div>
      </div>
      {badge}
    </div>
  );
}

/**
 * The colour this slot is read against, for the picker's live ratio.
 *
 * Reads BOTH sides of a `CONTRAST_PAIRS` entry, unlike the row's own badge,
 * which only fires for the `a` side. A background is exactly what someone drags
 * while watching whether the text on it still reads, so `bg0` has to know about
 * `fg0` — the pair is symmetric even though the list only spells it one way.
 */
function contrastPartner(
  slot: keyof ThemeColors,
  palette?: ThemeColors,
): { against: string; label: string } | null {
  if (!palette) return null;
  const pair = CONTRAST_PAIRS.find((p) => p.a === slot || p.b === slot);
  if (!pair) return null;
  const other = pair.a === slot ? pair.b : pair.a;
  const label = THEME_COLOR_FIELDS.find((f) => f.key === other)?.label ?? other;
  return { against: palette[other], label };
}

