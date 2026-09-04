import React from "react";

import { useSettingsFilter } from "./filterContext";

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
  if (visible && !visible.has(id)) return null;
  return (
    <div
      data-setting-id={id}
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "flex-start",
        gap: stacked ? 10 : 16,
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
