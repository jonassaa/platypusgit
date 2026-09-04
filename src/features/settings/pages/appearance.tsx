import React from "react";
import {
  PGButton,
  PGButtonGroup,
  PGIconButton,
  PGSelect,
  pgConfirm,
  pgFlash,
} from "@/design";
import {
  BUILTIN_THEMES,
  DENSITY_STEP_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  useSettingsStore,
  type ThemeDef,
  type ThemeFollowMode,
} from "@/features/settings/useSettingsStore";
import { HeadMarksControl } from "@/features/settings/HeadMarksControl";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { ThemeEditorDialog } from "@/features/settings/theme/ThemeEditorDialog";
import type { SettingsPageMeta } from "@/features/settings/nav/types";
import { commitDateText, type DateFormat } from "@/lib/commitDate";
import { appErrorMessage } from "@/lib/errors";

export const meta: SettingsPageMeta = {
  id: "general.appearance",
  group: "general",
  title: "Appearance",
  icon: "eye",
  cards: [
    {
      id: "appearance",
      title: "Appearance",
      subtitle: "Pick a theme, or customize every color and export it as a sharable file.",
      rows: [
        { id: "appearance.follow", label: "Appearance", keywords: "follow system os auto light dark mode" },
        { id: "appearance.light", label: "Light theme" },
        { id: "appearance.dark", label: "Dark theme", keywords: "dark mode" },
        { id: "appearance.theme", label: "Theme", keywords: "colors palette custom editor export" },
        { id: "appearance.density", label: "UI density", keywords: "compact cozy comfortable row height spacing" },
        { id: "appearance.dateFormat", label: "Date format", keywords: "relative absolute iso timestamp" },
        { id: "appearance.headMarks", label: "Current position (HEAD)", keywords: "bar tint ring marker" },
        { id: "appearance.zoom", label: "Zoom", keywords: "font size scale text bigger smaller" },
      ],
    },
  ],
};

// Three weeks ago, so the sample says something in every format: "now" would
// preview the relative form as "0s ago" and teach nothing about the choice.
const DATE_SAMPLE_NOW = Date.now();
const DATE_SAMPLE_TS = Math.floor(DATE_SAMPLE_NOW / 1000) - 60 * 60 * 24 * 21;

export function AppearancePage() {
  const s = useSettingsStore();
  const active = s.getActiveTheme();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isBuiltin = !!active.builtin;

  const [editor, setEditor] = React.useState<
    { kind: "new"; source: ThemeDef } | { kind: "edit"; id: string } | null
  >(null);

  const themeOptions = React.useMemo(() => {
    const builtins = BUILTIN_THEMES.map((t) => ({
      value: t.id,
      label: t.name,
    }));
    const customs = s.customThemes.map((t) => ({
      value: t.id,
      label: `★ ${t.name}`,
    }));
    return [...builtins, ...customs];
  }, [s.customThemes]);

  // Each half of the pairing may only name a theme of its own mode — offering
  // a dark theme as "the light one" would let the user build a pairing that
  // never switches.
  const pairOptions = React.useMemo(() => {
    const of = (mode: "dark" | "light") => [
      ...BUILTIN_THEMES.filter((t) => t.mode === mode).map((t) => ({
        value: t.id,
        label: t.name,
      })),
      ...s.customThemes
        .filter((t) => t.mode === mode)
        .map((t) => ({ value: t.id, label: `★ ${t.name}` })),
    ];
    return { light: of("light"), dark: of("dark") };
  }, [s.customThemes]);

  const following = s.themePreference.mode === "system";

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const theme = s.importThemeJson(text);
      pgFlash(`Imported "${theme.name}"`);
    } catch (err) {
      pgFlash(`Import failed: ${appErrorMessage(err)}`);
    }
  };

  const onDelete = async () => {
    if (
      !(await pgConfirm({
        title: `Delete theme "${active.name}"?`,
        body: "Custom themes aren't recoverable unless you exported the file.",
        danger: true,
        confirmLabel: "Delete theme",
      }))
    )
      return;
    s.deleteTheme(active.id);
  };

  return (
    <SettingsCard
      id="appearance"
      title="Appearance"
      subtitle="Pick a theme, or customize every color and export it as a sharable file."
    >
      <SettingsRow
        id="appearance.follow"
        label="Appearance"
        hint={
          following
            ? `Follows the OS — currently ${
                s.systemAppearance === "light" ? "light" : "dark"
              }. Pick the theme each half uses below.`
            : "One theme, always. Switch to “Follow system” to pair a light theme with a dark one."
        }
        control={
          <PGButtonGroup
            size="sm"
            value={s.themePreference.mode}
            onChange={(v) => s.setThemeFollowMode(v as ThemeFollowMode)}
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "system", label: "Follow system" },
            ]}
          />
        }
      />

      {following ? (
        <>
          <SettingsRow
            id="appearance.light"
            label="Light theme"
            hint="Applied while the OS is in light appearance."
            control={
              <PGSelect
                value={s.themePreference.lightId}
                onChange={(v) => s.setPairedThemeId("light", v)}
                options={pairOptions.light}
                size="sm"
                style={{ minWidth: 200 }}
              />
            }
          />
          <SettingsRow
            id="appearance.dark"
            label="Dark theme"
            hint="Applied while the OS is in dark appearance."
            control={
              <PGSelect
                value={s.themePreference.darkId}
                onChange={(v) => s.setPairedThemeId("dark", v)}
                options={pairOptions.dark}
                size="sm"
                style={{ minWidth: 200 }}
              />
            }
          />
        </>
      ) : (
        <SettingsRow
          id="appearance.theme"
          label="Theme"
          hint={
            isBuiltin
              ? "Built-in themes are read-only. Click “New custom theme” to fork and edit."
              : "Custom theme. Click “Edit custom theme” to change its colors."
          }
          control={
            <PGSelect
              value={active.id}
              onChange={(v) => s.setActiveThemeId(v)}
              options={themeOptions}
              size="sm"
              style={{ minWidth: 200 }}
            />
          }
        />
      )}

      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          background: "var(--bg-0)",
        }}
      >
        {!isBuiltin && (
          <PGButton
            size="sm"
            variant="primary"
            icon="edit"
            onClick={() => setEditor({ kind: "edit", id: active.id })}
          >
            Edit custom theme…
          </PGButton>
        )}
        <PGButton
          size="sm"
          variant={isBuiltin ? "primary" : "default"}
          icon="plus"
          onClick={() => setEditor({ kind: "new", source: active })}
          title="Create a new custom theme starting from the active one"
        >
          New custom theme…
        </PGButton>
        {!isBuiltin && (
          <PGButton
            size="sm"
            variant="default"
            icon="trash"
            onClick={() => void onDelete()}
          >
            Delete
          </PGButton>
        )}
        <div style={{ flex: 1 }} />
        <PGButton
          size="sm"
          variant="default"
          icon="download"
          onClick={() => s.downloadTheme(active.id)}
          title="Download as .pgtheme.json"
        >
          Export
        </PGButton>
        <PGButton
          size="sm"
          variant="default"
          icon="upload"
          onClick={onImportClick}
          title="Import a .pgtheme.json file"
        >
          Import…
        </PGButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json,.pgtheme.json"
          onChange={onImportFile}
          style={{ display: "none" }}
        />
      </div>

      <SettingsRow
        id="appearance.density"
        label="UI density"
        hint={`Compact matches the dense IDE feel; comfortable gives every list row ${DENSITY_STEP_PX.comfortable}px more breathing room.`}
        control={
          <PGButtonGroup
            size="sm"
            value={s.uiDensity}
            onChange={(v) => s.set("uiDensity", v as "compact" | "comfortable")}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
        }
      />

      <SettingsRow
        id="appearance.dateFormat"
        label="Date format"
        hint={
          <span data-testid="settings-date-format-hint">
            How a commit date is written in History, Reflog, Compare and the
            repository browser — right now:{" "}
            <span
              data-testid="settings-date-format-sample"
              style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}
            >
              {commitDateText(DATE_SAMPLE_TS, s.dateFormat, DATE_SAMPLE_NOW)}
            </span>
            . Hovering a date always shows the full timestamp, whichever format
            you pick, and commit details always shows it in full.
          </span>
        }
        control={
          <PGButtonGroup
            size="sm"
            value={s.dateFormat}
            onChange={(v) => s.set("dateFormat", v as DateFormat)}
            options={[
              { value: "relative", label: "Relative" },
              { value: "absolute", label: "Absolute" },
              { value: "both", label: "Both" },
            ]}
          />
        }
      />

      <SettingsRow
        id="appearance.headMarks"
        stacked
        label="Current position (HEAD)"
        hint="How History marks the commit you are on. Pick any combination of marks, then set how hard they hit — the preview is the real History row."
        control={<HeadMarksControl />}
      />

      <SettingsRow
        id="appearance.zoom"
        label="Zoom"
        hint={`Scales the whole window — ${Math.round(ZOOM_MIN * 100)}% to ${Math.round(
          ZOOM_MAX * 100,
        )}%. Also on ⌘/Ctrl with + and −, reset with ⌘/Ctrl 0.`}
        control={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PGIconButton
              icon="minus"
              size="md"
              title="Zoom out"
              onClick={() => s.stepZoom(-1)}
            />
            <span
              data-testid="settings-zoom-value"
              style={{
                minWidth: 48,
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--fg-1)",
              }}
            >
              {Math.round(s.uiZoom * 100)}%
            </span>
            <PGIconButton
              icon="plus"
              size="md"
              title="Zoom in"
              onClick={() => s.stepZoom(1)}
            />
            <PGButton
              size="sm"
              variant="ghost"
              disabled={s.uiZoom === 1}
              onClick={() => s.set("uiZoom", 1)}
            >
              Reset
            </PGButton>
          </div>
        }
      />

      {editor && (
        <ThemeEditorDialog
          mode={editor.kind}
          sourceTheme={
            editor.kind === "new"
              ? editor.source
              : (s.customThemes.find((t) => t.id === editor.id) ?? active)
          }
          onClose={() => setEditor(null)}
        />
      )}
    </SettingsCard>
  );
}
