import { PGInput, PGToggle } from "@/design";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "advanced.workspace",
  group: "advanced",
  title: "Workspace",
  icon: "repo",
  cards: [
    {
      id: "workspace",
      title: "Workspace",
      subtitle: "How the app watches and shells out to this machine.",
      rows: [
        { id: "workspace.watch", label: "Watch the working copy", keywords: "filesystem watcher notify refresh auto" },
        { id: "workspace.shell", label: "Terminal shell", keywords: "fish zsh bash pwsh powershell path binary" },
      ],
    },
  ],
};

export function WorkspacePage() {
  const s = useSettingsStore();

  return (
    <SettingsCard
      id="workspace"
      title="Workspace"
      subtitle="How the app watches and shells out to this machine."
    >
      <SettingsRow
        id="workspace.watch"
        label="Watch the working copy"
        hint="Notice edits made outside the app — in your editor or a terminal — and keep the file list and history up to date without a manual refresh. Ignored files are skipped, so a build directory costs nothing."
        control={
          <PGToggle
            data-testid="watch-filesystem"
            checked={s.watchFilesystem}
            onChange={(v) => s.set("watchFilesystem", v)}
          />
        }
      />
      <SettingsRow
        id="workspace.shell"
        label="Terminal shell"
        hint="The shell the built-in terminal runs, opened in the active repository's working directory. Leave blank to use the same shell as your own terminal ($SHELL, or PowerShell on Windows)."
        control={
          <PGInput
            data-testid="terminal-shell"
            value={s.terminalShell}
            placeholder="$SHELL"
            onChange={(v) => s.set("terminalShell", v)}
            style={{ width: 220 }}
          />
        }
      />
    </SettingsCard>
  );
}
