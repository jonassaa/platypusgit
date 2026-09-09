import React from "react";

import { PGIcon, pgConfirm, pgFlash } from "@/design";
import {
  BUILTIN_THEMES,
  useSettingsStore,
  type ThemeDef,
} from "@/features/settings/useSettingsStore";
import { exportThemeToFile } from "@/features/settings/themeFiles";
import { appErrorMessage } from "@/lib/errors";

import { ThemePreview } from "./ThemePreview";
import { useThemeEditorStore } from "./useThemeEditorStore";

/**
 * Pick a theme by looking at it.
 *
 * The picker used to be a `PGSelect` of names with a star in front of the
 * custom ones, so choosing a theme meant applying it to find out what it was.
 * Each card carries a real `ThemePreview` painted in that theme's own colours.
 *
 * With `appearance` given, the gallery drives ONE HALF of the light/dark
 * pairing and lists only themes of that mode — the rule the old `pairOptions`
 * enforced, because a pairing whose halves share a mode never switches.
 * Without it, it drives `activeThemeId`.
 *
 * It is a `radiogroup`: arrow keys move, and each move ACTIVATES the theme it
 * lands on, so arrow-browsing is a live preview rather than a focus walk. A
 * visual picker that is mouse-only is not a usability win.
 */
export function ThemeGallery({ appearance }: { appearance?: "light" | "dark" }) {
  const customThemes = useSettingsStore((s) => s.customThemes);
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const themePreference = useSettingsStore((s) => s.themePreference);

  const themes = React.useMemo(() => {
    const all = [...BUILTIN_THEMES, ...customThemes];
    return appearance ? all.filter((t) => t.mode === appearance) : all;
  }, [customThemes, appearance]);

  const selectedId = appearance
    ? appearance === "light"
      ? themePreference.lightId
      : themePreference.darkId
    : activeThemeId;

  const pick = (id: string) => {
    const s = useSettingsStore.getState();
    if (appearance) s.setPairedThemeId(appearance, id);
    else s.setActiveThemeId(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = themes.findIndex((t) => t.id === selectedId);
    const at = i < 0 ? 0 : i;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = at + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = themes.length - 1;
    else return;
    e.preventDefault();
    if (next < 0 || next >= themes.length) return;
    pick(themes[next].id);
  };

  const label =
    appearance === "light" ? "Light theme" : appearance === "dark" ? "Dark theme" : "Theme";

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 10,
        width: "100%",
      }}
    >
      {themes.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={theme.id === selectedId}
          onPick={() => pick(theme.id)}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  selected,
  onPick,
}: {
  theme: ThemeDef;
  selected: boolean;
  onPick: () => void;
}) {
  const isBuiltin = !!theme.builtin;

  const onExport = async () => {
    try {
      const path = await exportThemeToFile(theme.id);
      if (path) pgFlash(`Exported to ${path}`);
    } catch (err) {
      pgFlash(`Export failed: ${appErrorMessage(err)}`);
    }
  };

  const onDelete = async () => {
    if (
      !(await pgConfirm({
        title: `Delete theme “${theme.name}”?`,
        body: "Custom themes aren't recoverable unless you exported the file.",
        danger: true,
        confirmLabel: "Delete theme",
      }))
    )
      return;
    useSettingsStore.getState().deleteTheme(theme.id);
  };

  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={theme.name}
      tabIndex={selected ? 0 : -1}
      onClick={onPick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 6,
        cursor: "pointer",
        borderRadius: "var(--r-4)",
        background: selected ? "var(--bg-2)" : "var(--bg-1)",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border-1)",
        // Keep the box the same size selected or not, so the grid does not
        // reflow as the selection moves.
        margin: selected ? 0 : 1,
      }}
    >
      <ThemePreview theme={theme} size="card" title={theme.name} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {selected && (
          <PGIcon name="check" size={12} style={{ color: "var(--accent)" }} />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fs-12)",
            color: "var(--fg-0)",
            fontWeight: selected ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {theme.name}
        </span>
        <span
          style={{
            fontSize: "var(--fs-10)",
            fontFamily: "var(--font-mono)",
            color: "var(--fg-3)",
            flexShrink: 0,
          }}
        >
          {isBuiltin ? "Built-in" : "Custom"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        {/* Every action stops the click reaching the card, which would
            re-activate the theme as a side effect of pressing Delete. */}
        {!isBuiltin && (
          <CardAction
            icon="edit"
            label={`Edit ${theme.name}`}
            text="Edit"
            onClick={() => useThemeEditorStore.getState().openEdit(theme)}
          />
        )}
        <CardAction
          icon="copy"
          label={`Duplicate ${theme.name}`}
          text="Duplicate"
          onClick={() => useThemeEditorStore.getState().openNew(theme)}
        />
        <CardAction
          icon="download"
          label={`Export ${theme.name}`}
          text="Export…"
          onClick={() => void onExport()}
        />
        {!isBuiltin && (
          <CardAction
            icon="trash"
            label={`Delete ${theme.name}`}
            text="Delete"
            danger
            onClick={() => void onDelete()}
          />
        )}
      </div>
    </div>
  );
}

function CardAction({
  icon,
  label,
  text,
  danger,
  onClick,
}: {
  icon: "edit" | "copy" | "download" | "trash";
  label: string;
  text: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 5px",
        background: "transparent",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-2)",
        cursor: "pointer",
        color: danger ? "var(--git-removed)" : "var(--fg-2)",
        fontSize: "var(--fs-10)",
      }}
    >
      <PGIcon name={icon} size={10} />
      {text}
    </button>
  );
}
