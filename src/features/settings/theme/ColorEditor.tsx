import React from "react";

import { THEME_COLOR_FIELDS, type ThemeColors } from "@/features/settings/useSettingsStore";

export function ColorEditor({
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

export function ColorField({
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

export function normalizeHex(v: string): string | null {
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
