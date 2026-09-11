import React from "react";

import {
  PGButton,
  PGButtonGroup,
  PGIcon,
  PGInput,
  PGModal,
  PGSelect,
  PGSlider,
  pgConfirm,
  pgFlash,
} from "@/design";
import {
  BUILTIN_THEMES,
  useSettingsStore,
  type ThemeColors,
} from "@/features/settings/useSettingsStore";
import {
  exportThemeDraftToFile,
  readThemeFromFile,
} from "@/features/settings/themeFiles";
import { appErrorMessage } from "@/lib/errors";

import { ColorEditor, ColorField } from "./ColorEditor";
import { CONTRAST_PAIRS, contrastRatio, contrastReport } from "./contrast";
import {
  HARMONY_RULES,
  isGenerated,
  type HarmonyRule,
  type TraitLocks,
} from "./palette";
import { ThemePreview } from "./ThemePreview";
import { useThemeEditorStore } from "./useThemeEditorStore";

/**
 * The theme editor.
 *
 * Takes no props: it reads `useThemeEditorStore` for its open state, so the
 * Appearance page mounts it unconditionally and `app.closeOverlay` can close it
 * (see the store's own comment for why that matters). There is deliberately no
 * local Escape listener — `design/modal.tsx` documents that a component-local
 * capture-phase handler is the anti-pattern #47 was fixed to avoid.
 *
 * Two columns: controls, and a preview of the real UI. Live-apply to `:root`
 * stays — seeing the actual window change is worth keeping — but it is no
 * longer the ONLY feedback, which is what made a dimmed, 90%-obscured window
 * the judge of a palette.
 */
export function ThemeEditorDialog() {
  const ed = useThemeEditorStore();
  const customThemes = useSettingsStore((s) => s.customThemes);
  const [showAll, setShowAll] = React.useState(false);

  if (!ed.open) return null;

  const isNew = ed.open.mode === "new";
  const source = ed.open.sourceTheme;
  const findings = contrastReport(ed.colors);

  /** Every theme the guided start can begin from. */
  const baseOptions = [
    ...BUILTIN_THEMES.map((t) => ({ value: t.id, label: t.name })),
    ...customThemes.map((t) => ({ value: t.id, label: `★ ${t.name}` })),
  ];

  /**
   * Whether the palette is still exactly what the four traits produce.
   *
   * False is not an error state — it is the normal consequence of editing one
   * of the eighteen by hand, and all it does is say so.
   */
  const baseTheme = [...BUILTIN_THEMES, ...customThemes].find(
    (t) => t.id === ed.traits.baseId,
  );
  const generated = baseTheme ? isGenerated(ed.colors, baseTheme, ed.traits) : true;

  /** True while the draft still holds exactly the colours it opened with. */
  const untouched = (Object.keys(ed.colors) as (keyof ThemeColors)[]).every(
    (k) => ed.colors[k] === source.colors[k],
  );

  const onModeChange = async (next: "dark" | "light") => {
    if (next === ed.themeMode) return;
    const rebaseTo = BUILTIN_THEMES.find((t) => t.mode === next)!;
    // Nothing to lose while the draft is still the source's own palette, so
    // re-base without asking.
    if (untouched) {
      ed.applyBase(rebaseTo.id, ed.colors.accent);
      return;
    }
    const rebase = await pgConfirm({
      title: `Re-base the colours for ${next} mode?`,
      body: `${
        next === "light" ? "Dark greys under a light calibration" : "Light greys under a dark calibration"
      } are unreadable. Re-basing keeps your accent and takes the rest from the built-in ${next} theme. Your edits to the other colours are lost.`,
      confirmLabel: "Re-base colours",
      cancelLabel: "Keep my colours",
    });
    if (rebase) ed.applyBase(rebaseTo.id, ed.colors.accent);
    else ed.setThemeMode(next);
  };

  const onExport = async () => {
    try {
      const path = await exportThemeDraftToFile({
        name: ed.name,
        mode: ed.themeMode,
        colors: ed.colors,
      });
      if (path) pgFlash(`Exported to ${path}`);
    } catch (err) {
      pgFlash(`Export failed: ${appErrorMessage(err)}`);
    }
  };

  const onImport = async () => {
    try {
      const theme = await readThemeFromFile();
      if (!theme) return;
      ed.setColors(theme.colors);
      ed.setThemeMode(theme.mode);
      pgFlash(`Loaded “${theme.name}” into this draft`);
    } catch (err) {
      pgFlash(`Import failed: ${appErrorMessage(err)}`);
    }
  };

  const onSave = () => {
    const saved = ed.save();
    if (!saved) {
      pgFlash("Theme name can't be empty");
      return;
    }
    pgFlash(`Saved “${saved.name}”`);
  };

  return (
    <PGModal onCancel={ed.close} width={920}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            {isNew ? "New custom theme" : "Edit custom theme"}
          </div>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={ed.revert}>
            Revert changes
          </PGButton>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1fr) minmax(300px, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: "62vh",
              overflow: "auto",
            }}
          >
            <Field label="Name">
              <PGInput
                data-testid="theme-editor-name"
                value={ed.name}
                onChange={ed.setName}
                placeholder="My cool theme"
                style={{ flex: 1 }}
              />
            </Field>

            <Field label="Mode">
              <PGButtonGroup
                size="sm"
                value={ed.themeMode}
                onChange={(v) => void onModeChange(v as "dark" | "light")}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </Field>

            {/* ── Palette ─────────────────────────────────────────────────
                Four traits, each lockable, that generate all eighteen slots.
                This IS the guided start — base ramp is "Start from" and the
                accent is the seed — grown a harmony rule, a tint and a dice.
                The eighteen stay editable below; a hand edit there simply
                flips the readout to "Custom". */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 12px",
                border: "1px solid var(--border-0)",
                borderRadius: "var(--r-3)",
                background: "var(--bg-1)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <PGIcon name="palette" size={12} style={{ color: "var(--accent)" }} />
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-10)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--fg-2)",
                    fontWeight: 600,
                  }}
                >
                  Palette
                </div>
                <div style={{ flex: 1 }} />
                {!generated && (
                  <span
                    title="A colour has been edited by hand, so the palette is no longer exactly what these four traits produce."
                    style={{ fontSize: "var(--fs-10)", color: "var(--fg-3)" }}
                  >
                    Custom
                  </span>
                )}
              </div>

              <TraitRow
                label="Base ramp"
                trait="base"
                locks={ed.locks}
                onLock={ed.toggleLock}
              >
                <PGSelect
                  data-testid="theme-editor-base"
                  title="Which theme supplies the lightness ramp"
                  value={ed.baseId}
                  onChange={(v) => ed.applyBase(v, ed.traits.seed)}
                  options={baseOptions}
                  size="sm"
                  style={{ flex: 1 }}
                />
              </TraitRow>

              <TraitRow label="Accent" trait="seed" locks={ed.locks} onLock={ed.toggleLock}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ColorField
                    label="Accent"
                    hint="The one colour you pick. It becomes the accent, and the rest of the palette is placed around it."
                    value={ed.colors.accent}
                    onChange={(v) => ed.setTrait("seed", v)}
                    badge={<RatioBadge a="accentInk" b="accent" colors={ed.colors} />}
                    // The guided start's one field gets the same picker as the
                    // eighteen behind the disclosure — a wheel that appeared on
                    // the collapsed rows but not on the field everybody edits
                    // would be missing from where it matters most.
                    palette={ed.colors}
                    slot="accent"
                  />
                </div>
              </TraitRow>

              <TraitRow label="Harmony" trait="rule" locks={ed.locks} onLock={ed.toggleLock}>
                <PGSelect
                  data-testid="theme-trait-rule"
                  title="Where the surfaces and the logo colours sit, relative to the accent"
                  value={ed.traits.rule}
                  onChange={(v) => ed.setTrait("rule", v as HarmonyRule)}
                  options={HARMONY_RULES.map((r) => ({ value: r.id, label: r.label }))}
                  size="sm"
                  style={{ flex: 1 }}
                />
              </TraitRow>

              <TraitRow label="Tint" trait="strength" locks={ed.locks} onLock={ed.toggleLock}>
                <div style={{ flex: 1, minWidth: 0 }} data-testid="theme-trait-tint">
                  <PGSlider
                    name="Tint"
                    valueText={`${Math.round(ed.traits.strength * 100)}%`}
                    min={0}
                    max={1}
                    step={0.01}
                    value={ed.traits.strength}
                    trackCss={`linear-gradient(90deg, ${ed.colors.bg1}, ${ed.colors.accent})`}
                    onChange={(v) => ed.setTrait("strength", v)}
                  />
                </div>
              </TraitRow>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PGButton
                  data-testid="theme-shuffle"
                  size="sm"
                  icon="dice"
                  onClick={ed.shuffle}
                  title="Re-roll every unlocked trait"
                >
                  Shuffle
                </PGButton>
                <div
                  style={{
                    fontSize: "var(--fs-11)",
                    color: "var(--fg-3)",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  Lock what you want to keep. At 0% tint the surfaces stay exactly
                  as the base theme drew them.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                padding: "6px 0",
                cursor: "pointer",
                color: "var(--fg-1)",
                fontSize: "var(--fs-12)",
                textAlign: "left",
              }}
              aria-expanded={showAll}
            >
              <PGIcon name={showAll ? "chevronDown" : "chevronRight"} size={12} />
              All colours (18)
            </button>

            {showAll && (
              <div style={{ margin: "0 -16px" }}>
                <ColorEditor
                  colors={ed.colors}
                  onPatch={ed.patchColors}
                  badgeFor={(key) => {
                    const pair = CONTRAST_PAIRS.find((p) => p.a === key);
                    return pair ? (
                      <RatioBadge a={pair.a} b={pair.b} colors={ed.colors} />
                    ) : null;
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Preview ──────────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ThemePreview
              theme={{ name: ed.name, mode: ed.themeMode, colors: ed.colors }}
              size="pane"
            />
            {findings.length > 0 && (
              <div
                data-testid="theme-contrast-warnings"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "8px 10px",
                  border: "1px solid var(--border-0)",
                  borderRadius: "var(--r-3)",
                  background: "var(--bg-1)",
                }}
              >
                {findings.map((f) => (
                  <div
                    key={`${f.a}-${f.b}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "var(--fs-11)",
                      color:
                        f.level === "bad" ? "var(--git-removed)" : "var(--git-modified)",
                    }}
                  >
                    <PGIcon name="warn" size={12} />
                    <span style={{ flex: 1, minWidth: 0 }}>{f.what}</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      {f.ratio.toFixed(1)}:1
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
                  Below the 4.5:1 readability guideline. Saving is still up to you.
                </div>
              </div>
            )}
          </div>
        </div>

        <footer style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PGButton size="sm" icon="download" onClick={() => void onExport()}>
            Export draft…
          </PGButton>
          <PGButton size="sm" icon="upload" onClick={() => void onImport()}>
            Import into draft…
          </PGButton>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={ed.close}>
            Cancel
          </PGButton>
          <PGButton
            data-testid="theme-editor-save"
            size="sm"
            variant="primary"
            icon="check"
            onClick={onSave}
          >
            {isNew ? "Create theme" : "Save changes"}
          </PGButton>
        </footer>
      </div>
    </PGModal>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: "var(--fs-12)",
          color: "var(--fg-2)",
          width: 76,
          flexShrink: 0,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * One trait, with the lock that decides whether a shuffle may touch it.
 *
 * The lock is a button and not a checkbox because its state IS the icon: a
 * closed padlock reads as "keep this" at a glance down a column of four, where
 * a ticked box reads as "this is on" and leaves you working out what on meant.
 */
function TraitRow({
  label,
  trait,
  locks,
  onLock,
  children,
}: {
  label: string;
  trait: keyof TraitLocks;
  locks: TraitLocks;
  onLock: (key: keyof TraitLocks) => void;
  children: React.ReactNode;
}) {
  const locked = locks[trait];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        style={{
          fontSize: "var(--fs-12)",
          color: "var(--fg-2)",
          width: 76,
          flexShrink: 0,
        }}
      >
        {label}
      </label>
      {children}
      <button
        type="button"
        data-testid={`theme-lock-${trait}`}
        onClick={() => onLock(trait)}
        aria-pressed={locked}
        aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
        title={
          locked ? `${label} is locked — Shuffle will keep it` : `Lock ${label}`
        }
        style={{
          display: "flex",
          alignItems: "center",
          background: "transparent",
          border: "none",
          padding: 2,
          cursor: "pointer",
          color: locked ? "var(--accent)" : "var(--fg-3)",
          flexShrink: 0,
        }}
      >
        <PGIcon name={locked ? "lock" : "lockOpen"} size={12} />
      </button>
    </div>
  );
}

/**
 * The measured ratio, beside the colour it belongs to.
 *
 * The summary under the preview says what is wrong; this says it where the
 * colour is actually edited, so a fix does not require scrolling back.
 */
function RatioBadge({
  a,
  b,
  colors,
}: {
  a: keyof ThemeColors;
  b: keyof ThemeColors;
  colors: ThemeColors;
}) {
  const ratio = contrastRatio(colors[a] ?? "", colors[b] ?? "");
  if (!Number.isFinite(ratio)) return null;
  const bad = ratio < 3;
  const low = ratio < 4.5;
  return (
    <span
      title={`Contrast against the paired colour: ${ratio.toFixed(2)}:1`}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-10)",
        color: bad ? "var(--git-removed)" : low ? "var(--git-modified)" : "var(--fg-3)",
        flexShrink: 0,
      }}
    >
      {ratio.toFixed(1)}:1
    </span>
  );
}
