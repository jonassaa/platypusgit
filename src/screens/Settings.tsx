import { PGButton, PGIcon } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { AppearancePage } from "@/features/settings/pages/appearance";
import { BackupPage } from "@/features/settings/pages/backup";
import { CliPage } from "@/features/settings/pages/cli";
import { CommitPage } from "@/features/settings/pages/commit";
import { DiffPage } from "@/features/settings/pages/diff";
import { IntegrationsPage } from "@/features/settings/pages/integrations";
import { KeyboardPage } from "@/features/settings/pages/keyboard";
import { RemotePage } from "@/features/settings/pages/remote";
import { UpdatesPage } from "@/features/settings/pages/updates";
import { WorkspacePage } from "@/features/settings/pages/workspace";

export function SettingsScreen() {
  const s = useSettingsStore();

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

        <CommitPage />

        <AppearancePage />

        <RemotePage />

        <DiffPage />

        <IntegrationsPage />
        <KeyboardPage />
        <CliPage />
        <WorkspacePage />
        <UpdatesPage />
        <BackupPage />
      </div>
    </div>
  );
}
