import { PGButton, PGButtonGroup, PGIconButton, pgFlash } from "@/design";
import {
  SPACING_STEP_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  useSettingsStore,
  type ThemeFollowMode,
  type UiSpacing,
} from "@/features/settings/useSettingsStore";
import { HeadMarksControl } from "@/features/settings/HeadMarksControl";
import {
  densityPadding,
  SettingsCard,
  SettingsRow,
} from "@/features/settings/layout/SettingsCard";
import { ThemeEditorDialog } from "@/features/settings/theme/ThemeEditorDialog";
import { ThemeGallery } from "@/features/settings/theme/ThemeGallery";
import { useThemeEditorStore } from "@/features/settings/theme/useThemeEditorStore";
import { importThemeFromFile } from "@/features/settings/themeFiles";
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
        // The next three are mutually exclusive — `following ? pair : picker`
        // below — so each is gated to the mode that actually renders it.
        // Ungated, the index described all three at once and a search for
        // "light theme" on a fresh install (mode "fixed") reported "1 result"
        // and drew a card header with no rows under it.
        { id: "appearance.light", label: "Light theme", keywords: "gallery preview swatch add new create custom", when: "themeFollowsSystem" },
        { id: "appearance.dark", label: "Dark theme", keywords: "dark mode gallery preview swatch add new create custom", when: "themeFollowsSystem" },
        { id: "appearance.theme", label: "Theme", keywords: "colors palette custom editor export import gallery preview swatch duplicate contrast add new create", when: "themeFixed" },
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
  const isBuiltin = !!active.builtin;

  const following = s.themePreference.mode === "system";

  const onImport = async () => {
    try {
      const theme = await importThemeFromFile();
      if (theme) pgFlash(`Imported “${theme.name}”`);
    } catch (err) {
      pgFlash(`Import failed: ${appErrorMessage(err)}`);
    }
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
            stacked
            hint="Applied while the OS is in light appearance. Only light themes are offered — a pairing whose halves share a mode never switches."
            control={<ThemeGallery appearance="light" />}
          />
          <SettingsRow
            id="appearance.dark"
            label="Dark theme"
            stacked
            hint="Applied while the OS is in dark appearance."
            control={<ThemeGallery appearance="dark" />}
          />
        </>
      ) : (
        <SettingsRow
          id="appearance.theme"
          label="Theme"
          stacked
          hint={
            isBuiltin
              ? "Built-in themes are read-only — Add theme, or Duplicate this one, to start your own."
              : "Custom theme. Edit, duplicate, export or delete it on its card."
          }
          control={<ThemeGallery />}
        />
      )}

      {/* Edit, Duplicate, Export and Delete live on the cards, next to the
          theme they act on. These two belong to no card — they make a theme
          that does not exist yet — so they sit under the gallery. "Add" opens
          the editor on the active theme; which theme it starts from is the
          editor's own "Start from" picker, not a card you had to find first. */}
      <div
        // A geometry hook: only a real webview resolves the calc below, so e2e
        // measures this strip's height under each density.
        data-testid="theme-actions"
        style={{
          // Density-aware for the same reason its `SettingsRow` neighbours
          // are: this strip is in the card BODY, between two rows that scale,
          // so a fixed height here gives one card two row pitches. The chrome
          // exemption covers a card's HEADER, not a band between its rows.
          // Its own 10px base is kept — only the step is shared.
          padding: densityPadding(10),
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          background: "var(--bg-0)",
        }}
      >
        <PGButton
          size="sm"
          variant="primary"
          icon="plus"
          onClick={() => useThemeEditorStore.getState().openNew(active)}
          title="Start a new custom theme"
        >
          Add theme
        </PGButton>
        <PGButton
          size="sm"
          variant="default"
          icon="upload"
          onClick={() => void onImport()}
          title="Read a .pgtheme.json file"
        >
          Import theme…
        </PGButton>
        <span style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
          A new theme starts from the one you’re using — change that in the
          editor. Import reads a file someone exported.
        </span>
      </div>

      <SettingsRow
        id="appearance.density"
        label="UI density"
        hint={`Compact matches the dense IDE feel; Spacious gives every list row ${SPACING_STEP_PX.spacious}px more breathing room.`}
        control={
          <PGButtonGroup
            size="sm"
            value={s.uiSpacing}
            onChange={(v) => s.set("uiSpacing", v as UiSpacing)}
            options={[
              { value: "compact", label: "Compact" },
              { value: "cozy", label: "Cozy" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
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

      {/* Mounted unconditionally: the editor reads its own open state from
          `useThemeEditorStore`, which is what lets `app.closeOverlay` close it
          and restore the pre-draft theme. */}
      <ThemeEditorDialog />
    </SettingsCard>
  );
}
