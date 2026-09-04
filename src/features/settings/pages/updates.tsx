import React from "react";
import { PGButton, PGSelect } from "@/design";
import {
  useSettingsStore,
  type UpdateChannel,
  type UpdateCheckMode,
} from "@/features/settings/useSettingsStore";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import type { SettingsPageMeta } from "@/features/settings/nav/types";
import { STORE_MANAGED_NOTE } from "@/features/update/packageHint";
import {
  updatesManagedExternally,
  useUpdateStore,
} from "@/features/update/useUpdateStore";
import { relativeTime } from "@/lib/derive";

export const meta: SettingsPageMeta = {
  id: "general.updates",
  group: "general",
  title: "Updates",
  icon: "download",
  cards: [
    {
      id: "updates",
      title: "Updates",
      subtitle: "Check whether a newer PlatypusGit release is available.",
      rows: [
        { id: "updates.version", label: "Current version" },
        // Gated: absent from the DOM *and* the index on a Microsoft Store
        // install. Store policy 10.2.5 makes NAMING an update check the
        // violation, so a search result for "update" that says "Check for
        // updates" would be the v0.4.0 certification failure again.
        { id: "updates.check", label: "Check for updates", keywords: "automatic manual", when: "updatable" },
        { id: "updates.channel", label: "Release channel", keywords: "stable prerelease beta", when: "updatable" },
      ],
    },
  ],
};

function Mono({
  children,
  selectable,
}: {
  children: React.ReactNode;
  selectable?: boolean;
}) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        ...(selectable ? { userSelect: "all" as const } : null),
      }}
    >
      {children}
    </code>
  );
}

export function UpdatesPage() {
  const settings = useSettingsStore();
  const status = useUpdateStore((s) => s.status);
  const info = useUpdateStore((s) => s.info);
  const error = useUpdateStore((s) => s.error);
  const openPanel = useUpdateStore((s) => s.openPanel);
  const check = useUpdateStore((s) => s.check);
  // Single source: the store owns the running version (seeded from getVersion,
  // and confirmed by check() from the backend's env!("CARGO_PKG_VERSION")).
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const loadCurrentVersion = useUpdateStore((s) => s.loadCurrentVersion);
  const loadCapability = useUpdateStore((s) => s.loadCapability);
  const capability = useUpdateStore((s) => s.capability);
  const off = settings.updateCheckMode === "never";
  const storeManaged = updatesManagedExternally(capability);

  React.useEffect(() => {
    void loadCurrentVersion();
    // Loaded HERE and not left to `check()` (#360): on a Microsoft Store install
    // this section must render no update controls at all, and with
    // `updateCheckMode: "never"` no check ever runs to discover that.
    void loadCapability();
  }, [loadCurrentVersion, loadCapability]);

  let statusNode: React.ReactNode = null;
  if (status === "up-to-date") {
    statusNode = <>You're on the latest version.</>;
  } else if (status === "available" && info) {
    statusNode = (
      <>
        Update available:{" "}
        <button
          type="button"
          onClick={openPanel}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--accent)",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          {info.latestVersion}
        </button>
      </>
    );
  } else if (status === "error" && error) {
    statusNode = <span style={{ color: "var(--git-removed)" }}>{error}</span>;
  }

  // A Microsoft Store install gets the version and nothing else (#360).
  //
  // Not a disabled version of the normal section, and not a hidden one either.
  // Disabled controls would still be three statements ABOUT updates from
  // outside the Store — "Automatically asks GitHub", a release channel, a
  // "Check for updates" button — which is what policy 10.2.5 is about; the
  // v0.4.0 submission failed on a notification, having installed nothing.
  // Removing the section entirely would leave the user who came here looking
  // for their version with no answer and no explanation of why the setting
  // other installs have is missing. So: the version, and one line naming who
  // does the updating.
  //
  // `updateCheckMode` and `updateChannel` keep their persisted values
  // untouched. They are portable preferences (#254 exports them) and this
  // install is simply not consulting them — the same reasoning that leaves the
  // channel control enabled when checks are off.
  if (storeManaged) {
    return (
      <div data-testid="settings-updates">
        <SettingsCard id="updates" title="Updates">
          <SettingsRow
            id="updates.version"
            label="Current version"
            hint={<div data-testid="update-store-managed">{STORE_MANAGED_NOTE}</div>}
            control={<Mono>{currentVersion || "…"}</Mono>}
          />
        </SettingsCard>
      </div>
    );
  }

  return (
    <div data-testid="settings-updates">
      <SettingsCard
        id="updates"
        title="Updates"
        subtitle="Check whether a newer PlatypusGit release is available."
      >
        <SettingsRow
          id="updates.check"
          label="Check for updates"
          hint={
            <>
              <strong>Automatically</strong> asks GitHub shortly after launch.{" "}
              <strong>Only when I ask</strong> never checks on its own — the
              button below still works. <strong>Never</strong> makes no request
              at all, from any part of the app.
            </>
          }
          control={
            <PGSelect
              data-testid="update-check-mode"
              value={settings.updateCheckMode}
              onChange={(v) =>
                settings.set("updateCheckMode", v as UpdateCheckMode)
              }
              options={[
                { value: "auto", label: "Automatically" },
                { value: "manual", label: "Only when I ask" },
                { value: "never", label: "Never" },
              ]}
            />
          }
        />
        <SettingsRow
          id="updates.channel"
          label="Release channel"
          hint={
            <>
              <strong>Stable</strong> offers published releases only.{" "}
              <strong>Include prereleases</strong> also offers release
              candidates — newer, and not yet shipped to everyone. It adds
              prereleases to what you are offered rather than restricting you to
              them, so a stable release still wins whenever it is the newest
              thing published. Switching back to Stable does not downgrade an
              install; it just stops offering the next candidate.
              {/*
                Left enabled when checks are off. The preference is still real —
                it persists and travels in a settings export — and a control
                that appeared and disappeared as the row above changed would be
                worse than one that is simply not consulted right now.
              */}
            </>
          }
          control={
            <PGSelect
              data-testid="update-channel"
              value={settings.updateChannel}
              onChange={(v) => settings.set("updateChannel", v as UpdateChannel)}
              options={[
                { value: "stable", label: "Stable" },
                { value: "prerelease", label: "Include prereleases" },
              ]}
            />
          }
        />
        <SettingsRow
          id="updates.version"
          label="Current version"
          hint={
            <>
              <code style={{ fontFamily: "var(--font-mono)" }}>
                {currentVersion || "…"}
              </code>
              {statusNode && <> — {statusNode}</>}
              <div data-testid="update-last-checked" style={{ marginTop: 3 }}>
                {off ? (
                  // Not a dead end: the reason the button is disabled names the
                  // setting one row up, which is one click from "Only when I
                  // ask".
                  <>Update checks are turned off.</>
                ) : (
                  <>
                    Last checked:{" "}
                    {lastCheckedAt
                      ? relativeTime(Math.floor(lastCheckedAt / 1000))
                      : "never"}
                  </>
                )}
              </div>
            </>
          }
          control={
            <PGButton
              size="sm"
              onClick={() => check(true)}
              loading={status === "checking"}
              disabled={off}
              title={
                off ? "Update checks are turned off in Settings" : undefined
              }
            >
              Check for updates
            </PGButton>
          }
        />
      </SettingsCard>
    </div>
  );
}
