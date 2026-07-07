import React from "react";
import { platform } from "@tauri-apps/plugin-os";
import {
  PGButton,
  PGButtonGroup,
  PGIcon,
  PGInput,
  PGSelect,
  PGToggle,
  pgFlash,
} from "@/design";
import {
  BUILTIN_THEMES,
  THEME_COLOR_FIELDS,
  applyTheme,
  useSettingsStore,
  type ThemeColors,
  type ThemeDef,
} from "@/features/settings/useSettingsStore";
import { cliShimStatus, installCliShim, type PullMode } from "@/lib/tauri";
import type { CliShimStatus } from "@/lib/types";
import { BUILTIN_PRESETS, useKeymapStore } from "@/features/keymap";

export function SettingsScreen() {
  const s = useSettingsStore();
  const active = s.getActiveTheme();

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          padding: "28px 32px 64px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <PGIcon name="settings" size={20} style={{ color: "var(--accent)" }} />
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-20)",
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.01em",
              color: "var(--fg-0)",
            }}
          >
            Settings
          </h1>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={s.reset}>
            Reset to defaults
          </PGButton>
        </div>
        <p
          style={{
            margin: "0 0 24px",
            color: "var(--fg-2)",
            fontSize: "var(--fs-12)",
          }}
        >
          Preferences are saved locally and apply to every repository.
        </p>

        <AppearanceSection active={active} />

        <Section
          title="Pull & fetch"
          subtitle="How platypusgit updates your local branches from their upstream."
        >
          <Row
            label="Default pull mode"
            hint={
              <>
                <strong>Rebase</strong> replays your local commits on top of
                origin (linear history).{" "}
                <strong>Merge</strong> creates a merge commit.{" "}
                <strong>Fast-forward only</strong> refuses to pull if your branch has diverged.
              </>
            }
            control={
              <PGButtonGroup
                size="sm"
                value={s.defaultPullMode}
                onChange={(v) => s.set("defaultPullMode", v as PullMode)}
                options={[
                  { value: "Rebase", label: "Rebase" },
                  { value: "Merge", label: "Merge" },
                  { value: "FastForward", label: "FF-only" },
                ]}
              />
            }
          />
          <Row
            label="Auto-stash before pull"
            hint="Stash dirty changes, pull, then pop the stash. Prevents the 'uncommitted changes' error."
            control={
              <PGToggle
                checked={s.autoStashBeforePull}
                onChange={(v) => s.set("autoStashBeforePull", v)}
              />
            }
          />
          <Row
            label="Auto-fetch"
            hint="Periodically run fetch in the background so ahead/behind counts stay fresh."
            control={
              <PGToggle
                checked={s.autoFetchEnabled}
                onChange={(v) => s.set("autoFetchEnabled", v)}
              />
            }
          />
          <Row
            label="Auto-fetch interval"
            hint="Minutes between background fetches."
            control={
              <PGInput
                type="number"
                value={String(s.autoFetchMinutes)}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(60, parseInt(v, 10) || 5));
                  s.set("autoFetchMinutes", n);
                }}
                style={{ width: 72 }}
                disabled={!s.autoFetchEnabled}
              />
            }
          />
          <Row
            label="Prune on fetch"
            hint="Remove local refs whose upstream branches have been deleted on the remote."
            control={
              <PGToggle
                checked={s.pruneOnFetch}
                onChange={(v) => s.set("pruneOnFetch", v)}
              />
            }
          />
        </Section>

        <Section
          title="Push safety"
          subtitle="Guardrails around destructive remote operations."
        >
          <Row
            label="Confirm force-push"
            hint="Ask for confirmation before a force or force-with-lease push."
            control={
              <PGToggle
                checked={s.confirmForcePush}
                onChange={(v) => s.set("confirmForcePush", v)}
              />
            }
          />
        </Section>

        <Section
          title="Commit"
          subtitle="Defaults applied when creating a new commit."
        >
          <Row
            label="Append Signed-off-by"
            hint="Appends a DCO-style trailer to every commit message."
            control={
              <PGToggle
                checked={s.addSignoff}
                onChange={(v) => s.set("addSignoff", v)}
              />
            }
          />
        </Section>

        <Section title="Diff" subtitle="How diffs are rendered across the app.">
          <Row
            label="Context lines"
            hint="Unchanged lines shown around each hunk."
            control={
              <PGInput
                type="number"
                value={String(s.diffContextLines)}
                onChange={(v) => {
                  const n = Math.max(0, Math.min(20, parseInt(v, 10) || 3));
                  s.set("diffContextLines", n);
                }}
                style={{ width: 72 }}
              />
            }
          />
        </Section>

        <KeyboardSection />
        <CliSection />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SECTION — keymap preset picker
// ═════════════════════════════════════════════════════════════════════════════

function KeyboardSection() {
  const activePresetId = useKeymapStore((k) => k.activePresetId);
  return (
    <Section
      title="Keyboard"
      subtitle="Choose a keymap preset. Press ? anywhere to see the active bindings."
    >
      <Row
        label="Keymap"
        hint="Bindings apply across every screen. More presets coming."
        control={
          <PGSelect
            value={activePresetId}
            onChange={(v) => useKeymapStore.getState().setPreset(v)}
            options={BUILTIN_PRESETS.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            data-testid="keymap-preset-select"
          />
        }
      />
    </Section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI SECTION — install/status for the `pgit` shim
// ═════════════════════════════════════════════════════════════════════════════

function CliSection() {
  const isWindows = platform() === "windows";
  const [status, setStatus] = React.useState<CliShimStatus | null>(null);
  const [manual, setManual] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    cliShimStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  React.useEffect(() => {
    if (!isWindows) refresh();
  }, [isWindows, refresh]);

  const install = async () => {
    setBusy(true);
    try {
      const out = await installCliShim();
      if (out.installed) {
        setManual(null);
        // Deliberately doesn't repeat the shim path here — the status row
        // below shows it, and a toast echoing the same substring would
        // outlive the row's re-render (toast lives ~1.7s) and collide with
        // it in text queries.
        pgFlash("pgit installed");
        refresh();
      } else if (out.manualCommand) {
        setManual(out.manualCommand);
      }
    } catch {
      setManual(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Command line"
      subtitle="Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path]."
    >
      {isWindows ? (
        <Row
          label="pgit command"
          hint="Not yet supported on Windows. Add the install directory to PATH manually to use platypusgit.exe from a terminal."
          control={<span />}
        />
      ) : (
        <Row
          label="pgit command"
          hint={
            status?.installed ? (
              <>
                Installed at{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>
                  {status.shimPath}
                </code>
              </>
            ) : (
              <>
                Not installed.{" "}
                {manual && (
                  <>
                    Automatic install failed (permissions) — run:{" "}
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        userSelect: "all",
                      }}
                    >
                      {manual}
                    </code>
                  </>
                )}
              </>
            )
          }
          control={
            <PGButton size="sm" onClick={install} disabled={busy}>
              {status?.installed ? "Reinstall pgit" : "Install pgit"}
            </PGButton>
          }
        />
      )}
    </Section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// APPEARANCE SECTION — theme picker + color editor + import/export
// ═════════════════════════════════════════════════════════════════════════════

function AppearanceSection({ active }: { active: ThemeDef }) {
  const s = useSettingsStore();
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
      const msg = err instanceof Error ? err.message : String(err);
      pgFlash(`Import failed: ${msg}`);
    }
  };

  const onDelete = () => {
    if (!window.confirm(`Delete theme "${active.name}"?`)) return;
    s.deleteTheme(active.id);
  };

  return (
    <Section
      title="Appearance"
      subtitle="Pick a theme, or customize every color and export it as a sharable file."
    >
      <Row
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
            onClick={onDelete}
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

      <Row
        label="UI density"
        hint="Compact matches the dense IDE feel; comfortable adds padding."
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
    </Section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// THEME EDITOR DIALOG — color pickers live here, behind Add/Edit buttons.
// ═════════════════════════════════════════════════════════════════════════════

function ThemeEditorDialog({
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

function ColorEditor({
  colors,
  onPatch,
}: {
  colors: ThemeColors;
  onPatch: (p: Partial<ThemeColors>) => void;
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
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const commitHex = (v: string) => {
    const normalized = normalizeHex(v);
    if (!normalized) return;
    onChange(normalized);
  };

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
      <label
        style={{
          position: "relative",
          width: 28,
          height: 28,
          borderRadius: "var(--r-3)",
          border: "1px solid var(--border-1)",
          background: value,
          cursor: "pointer",
          flexShrink: 0,
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            border: "none",
          }}
        />
      </label>
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
    </div>
  );
}

function normalizeHex(v: string): string | null {
  const raw = v.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

// ─── Shared layout helpers ───────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: 20,
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-4)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border-0)",
          background: "var(--bg-2)",
        }}
      >
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
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--fs-12)",
              color: "var(--fg-3)",
            }}
          >
            {subtitle}
          </div>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-13)",
            color: "var(--fg-0)",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 3,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>{control}</div>
    </div>
  );
}

