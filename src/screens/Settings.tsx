import React from "react";
import { PGIcon } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsFilterProvider } from "@/features/settings/layout/filterContext";
import { SettingsNav } from "@/features/settings/nav/SettingsNav";
import { PAGES } from "@/features/settings/nav/pages";
import { resolvePageId } from "@/features/settings/nav/types";

export function SettingsScreen() {
  const s = useSettingsStore();
  const pageId = resolvePageId(s.settingsPage);
  const [query, setQuery] = React.useState("");
  const { Page, meta } = PAGES[pageId];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "var(--bg-0)" }}>
      <SettingsNav
        pageId={pageId}
        onSelect={(id) => s.set("settingsPage", id)}
        query={query}
        onQueryChange={setQuery}
        matchCounts={null}
        onReset={s.reset}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 32px 64px" }}>
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
              {meta.title}
            </h1>
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

          <SettingsFilterProvider visibleRowIds={null}>
            <div data-settings-page={pageId}>
              <Page />
            </div>
          </SettingsFilterProvider>
        </div>
      </div>
    </div>
  );
}
