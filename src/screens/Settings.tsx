import React from "react";
import { PGIcon } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsFilterProvider } from "@/features/settings/layout/filterContext";
import { matchCountsByPage, matchRows } from "@/features/settings/nav/match";
import { SettingsNav } from "@/features/settings/nav/SettingsNav";
import { SettingsResults } from "@/features/settings/nav/SettingsResults";
import { useSettingsIndex } from "@/features/settings/nav/useSettingsIndex";
import { PAGES } from "@/features/settings/nav/pages";
import { resolvePageId } from "@/features/settings/nav/types";
import { useUpdateStore } from "@/features/update/useUpdateStore";

export function SettingsScreen() {
  const s = useSettingsStore();
  const pageId = resolvePageId(s.settingsPage);
  const [query, setQuery] = React.useState("");
  const { Page, meta } = PAGES[pageId];

  // Prime the update capability whenever Settings OPENS, not just when the
  // Updates page mounts. The flat screen this replaced rendered
  // `UpdatesSection` unconditionally, so its own mount effect primed the
  // capability for the whole screen; per-page mounting broke that, and the
  // search index (below) is a second reader of it — one that must not name an
  // update check on a Microsoft Store install even for a frame (policy 10.2.5;
  // v0.4.0 failed certification on a notification). `loadCapability` returns
  // early when the capability is already known, so this is idempotent and
  // costs one IPC call per app run. Read through `getState()` rather than a
  // selector: this screen wants the action, not a subscription.
  React.useEffect(() => {
    void useUpdateStore.getState().loadCapability();
  }, []);

  const index = useSettingsIndex();
  const searching = query.trim().length > 0;
  const hits = React.useMemo(
    () => (searching ? matchRows(query, index) : []),
    [searching, query, index],
  );
  const matchCounts = React.useMemo(
    () => (searching ? matchCountsByPage(hits) : null),
    [searching, hits],
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "var(--bg-0)" }}>
      <SettingsNav
        pageId={pageId}
        onSelect={(id) => s.set("settingsPage", id)}
        query={query}
        onQueryChange={setQuery}
        matchCounts={matchCounts}
        onReset={s.reset}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 32px 64px" }}>
          {searching ? (
            <SettingsResults hits={hits} query={query} onClear={() => setQuery("")} />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
