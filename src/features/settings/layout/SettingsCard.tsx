import React from "react";

import { useSettingsFilter } from "./filterContext";
import { useSettingsHighlight } from "./highlightContext";

/**
 * The opt-in into both UI scales — Spacing and Text size — for a settings
 * surface, as vertical padding.
 *
 * `--row-step` is the WHOLE extra height a row spends, so padding — applied
 * top AND bottom — takes half of it. Writing `var(--row-step)` here instead
 * double-counts, the trap `src/index.css` names where it defines the token.
 *
 * A function rather than one bare string because the bases differ (a row is
 * 12px, the theme action strip 10px) while the STEP must not: two surfaces in
 * one card that grow by different amounts is the same bug as one that does not
 * grow at all.
 *
 * `--row-scale` multiplies the BASE and not the step: the step is already the
 * user's own number in pixels, while the base is what has to hold the text.
 */
export function densityPadding(basePx: number): string {
  return `calc(${basePx}px * var(--row-scale) + var(--row-step) / 2) 16px`;
}

/**
 * The padding EVERY settings row uses — `SettingsRow` here and `ForgeRow` in
 * `features/forge/ForgeSettings.tsx`, a separate component by design that
 * nonetheless sits in the same panel.
 *
 * Shared as one value rather than copied as one string, because the two being
 * EQUAL is the actual requirement: a forge account row a few pixels off from
 * the setting directly above it is the bug this closes, and two literals
 * cannot fail a test when only one of them is edited.
 */
export const SETTINGS_ROW_PADDING = densityPadding(12);

/**
 * The one card/row layout pair for the Settings screen.
 *
 * Was defined twice — `screens/Settings.tsx` and `features/forge/
 * ForgeSettings.tsx` — which is exactly how the two drifted. It lives under
 * `features/settings/` and NOT in `src/design/` on purpose: it reads the
 * settings filter context, and a feature context has no business inside the
 * design system.
 */
export function SettingsCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const visible = useSettingsFilter();
  // A card whose declared rows all filtered out renders nothing — header
  // included. `CARD_ROW_IDS` is the declared truth, so this decision is made
  // before the children render.
  if (visible && !cardHasVisibleRow(id, visible)) return null;
  return (
    <section
      data-settings-card={id}
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

/**
 * `stacked` puts the control on its own full-width line under the label. The
 * inline layout gives the control whatever width it asks for (`flexShrink: 0`),
 * which is right for a button group or a select but crushes the label column to
 * a word per line once the control is intrinsically wide — a live preview of a
 * real History row, say.
 */
export function SettingsRow({
  id,
  label,
  hint,
  control,
  stacked,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  const visible = useSettingsFilter();
  const highlightTerms = useSettingsHighlight();
  if (visible && !visible.has(id)) return null;
  return (
    <div
      data-setting-id={id}
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "flex-start",
        gap: stacked ? 10 : 16,
        // A list-row surface, so it opts into both UI scales (#70). The
        // card's header above stays fixed: that is chrome, not a row.
        padding: SETTINGS_ROW_PADDING,
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
          {highlightLabel(label, highlightTerms)}
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
      <div style={stacked ? { minWidth: 0 } : { flexShrink: 0, paddingTop: 2 }}>{control}</div>
    </div>
  );
}

/**
 * Declared row ids per card, registered by `nav/pages.ts` at module load.
 *
 * A registry rather than a static import because the dependency runs the other
 * way: the pages import this layout pair, so this file cannot import them
 * without a cycle.
 */
const CARD_ROWS = new Map<string, readonly string[]>();

export function registerCardRows(cardId: string, rowIds: readonly string[]): void {
  CARD_ROWS.set(cardId, rowIds);
}

function cardHasVisibleRow(cardId: string, visible: ReadonlySet<string>): boolean {
  const declared = CARD_ROWS.get(cardId);
  // An unregistered card is one nothing declared — during a search it has no
  // matching rows by definition, so hiding it is right. Before Task 3 wires the
  // registry no search exists, and `visible` is always null.
  if (!declared) return false;
  return declared.some((id) => visible.has(id));
}

/**
 * Wrap every occurrence of a search term in `label`.
 *
 * Splits on a capturing regex — `String.prototype.split` manages its own
 * iteration over the pattern and does not touch `lastIndex`, unlike
 * `RegExp.prototype.test`/`exec` on a `/g` regex, which advance it on every
 * call. Deciding each part by membership in a lowercased `Set` (rather than
 * re-testing the stateful regex against it) is what keeps a label containing
 * a term more than once highlighting EVERY occurrence, not alternating ones.
 */
function highlightLabel(label: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return label;
  const lowerTerms = new Set(terms.map((t) => t.toLowerCase()));
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return label
    .split(re)
    .map((part, i) =>
      lowerTerms.has(part.toLowerCase()) ? (
        <span key={i} style={{ background: "var(--bg-selection)", color: "var(--fg-0)" }}>
          {part}
        </span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
