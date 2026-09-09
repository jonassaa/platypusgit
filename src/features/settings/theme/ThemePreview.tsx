import React from "react";

import {
  themeVars,
  type ThemeColors,
  type ThemeDef,
} from "@/features/settings/useSettingsStore";

/**
 * A miniature of the real app, painted in ANY theme.
 *
 * A palette is judged on composed surfaces — a history row, a diff hunk, a
 * button — not on eighteen swatches. Before this the only way to see a theme
 * was to apply it, which is why picking one meant applying it to find out.
 *
 * **Everything inside paints through `var(--…)`, one scope down.** The root
 * element carries `themeVars(theme)` as inline custom properties and the tree
 * below reads only those vars — never `props.theme` directly, and never a
 * `:root` var. That is what makes the preview honest: it renders through the
 * same variables the app does, so it cannot disagree with the live window, and
 * a light theme's card stays light on a dark page.
 */
export type ThemePreviewTheme = {
  name?: string;
  mode: "dark" | "light";
  colors: ThemeColors;
};

/** Type-scale and spacing per size. One tree, two calibrations — not two trees. */
const SCALE = {
  card: { fs: 8, gap: 2, row: 11, pad: 4, chrome: 12, minHeight: 104 },
  pane: { fs: 11, gap: 5, row: 18, pad: 8, chrome: 20, minHeight: 260 },
} as const;

export function ThemePreview({
  theme,
  size,
  title,
}: {
  theme: ThemePreviewTheme;
  size: "card" | "pane";
  title?: string;
}) {
  const s = SCALE[size];
  // `themeVars` wants a ThemeDef; the id and name are only used for the
  // `data-theme` stamps that `applyTheme` writes, which a preview must not
  // claim — so a local id is right here.
  const vars = themeVars({
    id: "__preview__",
    name: theme.name ?? "Preview",
    mode: theme.mode,
    colors: theme.colors,
  } as ThemeDef);

  return (
    <div
      data-testid="theme-preview"
      data-size={size}
      title={title}
      aria-hidden
      style={
        {
          ...vars,
          // A picture, not a control: nothing inside takes focus or a click, so
          // a card that is itself a radio keeps its own semantics.
          pointerEvents: "none",
          userSelect: "none",
          width: "100%",
          minHeight: s.minHeight,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: "var(--r-3)",
          border: "1px solid var(--border-1)",
          background: "var(--bg-0)",
          fontSize: s.fs,
          lineHeight: 1.35,
        } as React.CSSProperties
      }
    >
      <Titlebar s={s} />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Sidebar s={s} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <History s={s} />
          <Diff s={s} />
        </div>
      </div>
      <StatusBar s={s} />
    </div>
  );
}

type S = (typeof SCALE)[keyof typeof SCALE];

function Titlebar({ s }: { s: S }) {
  return (
    <div
      data-testid="theme-preview-titlebar"
      style={{
        height: s.chrome,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: s.gap,
        padding: `0 ${s.pad}px`,
        background: "var(--bg-titlebar)",
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      {/* The logo mark, as two shapes rather than the real SVG: the preview
          needs the two brand slots to be visible, not the artwork. */}
      <div
        style={{
          width: s.fs,
          height: s.fs,
          borderRadius: "50%",
          background: "var(--logo)",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          width: s.fs * 0.6,
          height: s.fs * 0.4,
          borderRadius: 2,
          background: "var(--logo-2)",
          flexShrink: 0,
        }}
      />
      <div style={{ color: "var(--fg-1)", marginLeft: s.gap }}>platypusgit</div>
      <div style={{ flex: 1 }} />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: s.fs * 0.5,
            height: s.fs * 0.5,
            borderRadius: "50%",
            background: "var(--fg-3)",
          }}
        />
      ))}
    </div>
  );
}

function Sidebar({ s }: { s: S }) {
  const rows = ["History", "Changes", "Branches"];
  return (
    <div
      data-testid="theme-preview-sidebar"
      style={{
        // 6.5em, not 5: at 5 the longest label ("Branches") was clipped
        // mid-word at both sizes, which read as a rendering bug rather than a
        // narrow sidebar.
        width: `${s.fs * 6.5}px`,
        flexShrink: 0,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border-0)",
        padding: `${s.pad}px 0`,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {rows.map((row, i) => (
        <div
          key={row}
          style={{
            height: s.row,
            display: "flex",
            alignItems: "center",
            paddingLeft: s.pad,
            color: i === 0 ? "var(--fg-0)" : "var(--fg-2)",
            background: i === 0 ? "var(--bg-4)" : "transparent",
            borderLeft: `2px solid ${i === 0 ? "var(--accent)" : "transparent"}`,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {row}
        </div>
      ))}
    </div>
  );
}

function History({ s }: { s: S }) {
  const commits = [
    { subject: "feat(diff): word-level highlight", meta: "2h", selected: true },
    { subject: "fix(status): stale index", meta: "5h", selected: false },
  ];
  return (
    <div
      data-testid="theme-preview-history"
      style={{
        background: "var(--bg-0)",
        padding: `${s.pad}px 0`,
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      {commits.map((c) => (
        <div
          key={c.subject}
          style={{
            height: s.row,
            display: "flex",
            alignItems: "center",
            gap: s.gap,
            padding: `0 ${s.pad}px`,
            background: c.selected ? "var(--bg-selection)" : "transparent",
          }}
        >
          {/* Graph dot + edge, in the graph palette rather than the accent —
              the two are calibrated separately and both belong in the picture. */}
          <div
            style={{
              width: s.fs * 0.55,
              height: s.fs * 0.55,
              borderRadius: "50%",
              background: "var(--graph-1)",
              flexShrink: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              color: "var(--fg-0)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.subject}
          </div>
          <div style={{ color: "var(--fg-2)", flexShrink: 0 }}>{c.meta}</div>
        </div>
      ))}
    </div>
  );
}

function Diff({ s }: { s: S }) {
  const lines = [
    { n: "12", text: "  const theme = resolve(pref);", kind: "ctx" as const },
    { n: "13", text: "  applyTheme(theme);", kind: "add" as const },
    { n: "14", text: "  applyLegacy(theme);", kind: "del" as const },
    { n: "15", text: "  return theme;", kind: "ctx" as const },
    { n: "16", text: "}", kind: "ctx" as const },
  ];
  const bg = { ctx: "transparent", add: "var(--git-added-bg)", del: "var(--git-removed-bg)" };
  const mark = { ctx: " ", add: "+", del: "−" };
  const markFg = { ctx: "var(--fg-3)", add: "var(--git-added)", del: "var(--git-removed)" };

  return (
    <div data-testid="theme-preview-diff" style={{ flex: 1, minHeight: 0, background: "var(--bg-0)" }}>
      <div
        style={{
          height: s.row,
          display: "flex",
          alignItems: "center",
          padding: `0 ${s.pad}px`,
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border-0)",
          color: "var(--fg-1)",
          gap: s.gap,
        }}
      >
        <span style={{ color: "var(--git-modified)" }}>M</span>
        <span>useSettingsStore.ts</span>
      </div>
      {lines.map((l) => (
        <div
          key={l.n}
          style={{
            display: "flex",
            alignItems: "center",
            gap: s.gap,
            padding: `0 ${s.pad}px`,
            height: s.row,
            background: bg[l.kind],
            fontFamily: "var(--font-mono)",
          }}
        >
          <span style={{ color: "var(--fg-3)", width: s.fs * 1.4, flexShrink: 0 }}>{l.n}</span>
          <span style={{ color: markFg[l.kind], width: s.fs * 0.7, flexShrink: 0 }}>
            {mark[l.kind]}
          </span>
          <span
            style={{
              color: "var(--fg-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {l.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusBar({ s }: { s: S }) {
  return (
    <div
      style={{
        height: s.chrome,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: s.gap,
        padding: `0 ${s.pad}px`,
        background: "var(--bg-2)",
        borderTop: "1px solid var(--border-0)",
        color: "var(--fg-2)",
      }}
    >
      <span>main</span>
      <div style={{ flex: 1 }} />
      {/* The accent / accent-ink pair, which is exactly what the contrast
          warning is about — so it has to be visible in the picture. */}
      <div
        data-testid="theme-preview-button"
        style={{
          padding: `0 ${s.pad}px`,
          height: s.chrome - s.gap * 2,
          display: "flex",
          alignItems: "center",
          borderRadius: 2,
          background: "var(--accent)",
          color: "var(--accent-ink)",
          fontWeight: 600,
        }}
      >
        Commit
      </div>
    </div>
  );
}
