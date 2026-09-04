import React from "react";
import { PGButton, PGButtonGroup, PGIcon, PGInput, pgFlash } from "@/design";
import {
  applyTheme,
  useSettingsStore,
  type ThemeColors,
  type ThemeDef,
} from "@/features/settings/useSettingsStore";

import { ColorEditor } from "./ColorEditor";

export function ThemeEditorDialog({
  mode,
  sourceTheme,
  onClose,
}: {
  mode: "new" | "edit";
  sourceTheme: ThemeDef;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(
    mode === "new" ? `${sourceTheme.name} (custom)` : sourceTheme.name,
  );
  const [themeMode, setThemeMode] = React.useState<"dark" | "light">(sourceTheme.mode);
  const [colors, setColors] = React.useState<ThemeColors>({ ...sourceTheme.colors });

  // Capture the theme that was active on open, so Cancel can restore it.
  const originalActiveRef = React.useRef<ThemeDef | null>(null);
  if (originalActiveRef.current === null) {
    originalActiveRef.current = useSettingsStore.getState().getActiveTheme();
  }

  // Live preview: apply draft to CSS vars whenever it changes.
  React.useEffect(() => {
    applyTheme({
      id: "__draft__",
      name,
      mode: themeMode,
      colors,
    });
  }, [name, themeMode, colors]);

  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    // Restore the theme that was active before the dialog opened.
    const orig = originalActiveRef.current;
    if (orig) applyTheme(orig);
    onClose();
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pgFlash("Theme name can't be empty");
      return;
    }
    const store = useSettingsStore.getState();
    if (mode === "new") {
      // Create a new custom theme, make it active.
      // First switch to source so saveAsNewTheme copies right colors — but we
      // have our own draft, so inject directly.
      const created = store.saveAsNewTheme(trimmed);
      // Overwrite its colors/mode with the draft.
      useSettingsStore.setState((st) => ({
        customThemes: st.customThemes.map((t) =>
          t.id === created.id
            ? { ...t, name: trimmed, mode: themeMode, colors: { ...colors } }
            : t,
        ),
      }));
      // Through the store, not just `setState`: the draft's dark/light toggle
      // may have flipped the mode the duplicate inherited, and in "follow the
      // system" mode that decides WHICH half of the pairing this theme is.
      useSettingsStore.getState().setActiveThemeId(created.id);
      // Re-apply so the saved version is what's showing.
      applyTheme({
        ...created,
        name: trimmed,
        mode: themeMode,
        colors,
      });
      pgFlash(`Saved "${trimmed}"`);
    } else {
      // Edit existing custom theme.
      useSettingsStore.setState((st) => ({
        customThemes: st.customThemes.map((t) =>
          t.id === sourceTheme.id
            ? { ...t, name: trimmed, mode: themeMode, colors: { ...colors } }
            : t,
        ),
      }));
      useSettingsStore.getState().setActiveThemeId(sourceTheme.id);
      applyTheme({
        ...sourceTheme,
        name: trimmed,
        mode: themeMode,
        colors,
      });
      pgFlash(`Saved "${trimmed}"`);
    }
    onClose();
  };

  const handleResetColors = () => {
    setColors({ ...sourceTheme.colors });
    setThemeMode(sourceTheme.mode);
  };

  const patch = (p: Partial<ThemeColors>) =>
    setColors((c) => ({ ...c, ...p }));

  return (
    <div
      onClick={handleCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "new" ? "New custom theme" : "Edit custom theme"}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-5)",
          boxShadow: "var(--shadow-3)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-0)",
            background: "var(--bg-2)",
          }}
        >
          <PGIcon name="edit" size={14} style={{ color: "var(--accent)" }} />
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--fg-1)",
              fontWeight: 600,
            }}
          >
            {mode === "new" ? "New custom theme" : "Edit custom theme"}
          </div>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={handleResetColors}>
            Revert changes
          </PGButton>
        </header>

        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-0)" }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                minWidth: 240,
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-12)",
                  color: "var(--fg-2)",
                  width: 48,
                  flexShrink: 0,
                }}
              >
                Name
              </span>
              <PGInput
                value={name}
                onChange={setName}
                placeholder="My cool theme"
                style={{ flex: 1 }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}>
                Mode
              </span>
              <PGButtonGroup
                size="sm"
                value={themeMode}
                onChange={(v) => setThemeMode(v as "dark" | "light")}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </div>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
            }}
          >
            Changes preview live. Cancel to discard, Save to keep.
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <ColorEditor colors={colors} onPatch={patch} />
        </div>

        <footer
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-0)",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: "var(--bg-2)",
          }}
        >
          <PGButton
            size="sm"
            variant="default"
            icon="download"
            onClick={() => {
              // Export the current draft without saving.
              const payload = JSON.stringify(
                {
                  $schema: "https://platypusgit.dev/theme.schema.json",
                  version: 1,
                  name,
                  mode: themeMode,
                  colors,
                },
                null,
                2,
              );
              const slug = (name || "theme")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");
              const blob = new Blob([payload], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${slug || "theme"}.pgtheme.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            Export draft
          </PGButton>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </PGButton>
          <PGButton size="sm" variant="primary" icon="check" onClick={handleSave}>
            {mode === "new" ? "Create theme" : "Save changes"}
          </PGButton>
        </footer>
      </div>
    </div>
  );
}
