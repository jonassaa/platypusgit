import { PGButtonGroup, PGInput, PGSelect, PGToggle } from "@/design";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { SettingsPageMeta } from "@/features/settings/nav/types";
import type { PullMode } from "@/lib/tauri";
import type { UpdateRefsMode } from "@/lib/types";

export const meta: SettingsPageMeta = {
  id: "git.remote",
  group: "git",
  title: "Remote & sync",
  icon: "sync",
  cards: [
    {
      id: "pull",
      title: "Pull & fetch",
      subtitle: "How platypusgit updates your local branches from their upstream.",
      rows: [
        { id: "pull.mode", label: "Default pull mode", keywords: "rebase merge ff-only fast forward" },
        { id: "pull.autostash", label: "Auto-stash before pull", keywords: "dirty working copy stash" },
        { id: "fetch.auto", label: "Auto-fetch", keywords: "background poll automatic" },
        { id: "fetch.interval", label: "Auto-fetch interval", keywords: "minutes frequency" },
        { id: "fetch.prune", label: "Prune on fetch", keywords: "delete stale remote branches" },
      ],
    },
    {
      id: "push",
      title: "Push safety",
      subtitle: "Guardrails around destructive remote operations.",
      rows: [{ id: "push.confirmForce", label: "Confirm force-push", keywords: "force lease destructive overwrite" }],
    },
    {
      id: "rebase",
      title: "Rebase",
      subtitle: "How a rebase treats branches that point inside the replayed range.",
      rows: [{ id: "rebase.updateRefs", label: "Move dependent branches", keywords: "update-refs stacked dependent" }],
    },
  ],
};

export function RemotePage() {
  const s = useSettingsStore();

  return (
    <>
      <SettingsCard
        id="pull"
        title="Pull & fetch"
        subtitle="How platypusgit updates your local branches from their upstream."
      >
        <SettingsRow
          id="pull.mode"
          label="Default pull mode"
          hint={
            <>
              <strong>Rebase</strong> replays your local commits on top of
              origin (linear history).{" "}
              <strong>Merge</strong> creates a merge commit.{" "}
              <strong>Fast-forward only</strong> refuses to pull if your branch has diverged.
            </>
          }
          control={
            <PGButtonGroup
              size="sm"
              value={s.defaultPullMode}
              onChange={(v) => s.set("defaultPullMode", v as PullMode)}
              options={[
                { value: "Rebase", label: "Rebase" },
                { value: "Merge", label: "Merge" },
                { value: "FastForward", label: "FF-only" },
              ]}
            />
          }
        />
        <SettingsRow
          id="pull.autostash"
          label="Auto-stash before pull"
          hint="Stash dirty changes, pull, then pop the stash. Prevents the 'uncommitted changes' error."
          control={
            <PGToggle
              checked={s.autoStashBeforePull}
              onChange={(v) => s.set("autoStashBeforePull", v)}
            />
          }
        />
        <SettingsRow
          id="fetch.auto"
          label="Auto-fetch"
          hint="Periodically run fetch in the background so ahead/behind counts stay fresh."
          control={
            <PGToggle
              checked={s.autoFetchEnabled}
              onChange={(v) => s.set("autoFetchEnabled", v)}
            />
          }
        />
        <SettingsRow
          id="fetch.interval"
          label="Auto-fetch interval"
          hint="Minutes between background fetches."
          control={
            <PGInput
              type="number"
              value={String(s.autoFetchMinutes)}
              onChange={(v) => {
                const n = Math.max(1, Math.min(60, parseInt(v, 10) || 5));
                s.set("autoFetchMinutes", n);
              }}
              style={{ width: 72 }}
              disabled={!s.autoFetchEnabled}
            />
          }
        />
        <SettingsRow
          id="fetch.prune"
          label="Prune on fetch"
          hint="Remove local refs whose upstream branches have been deleted on the remote."
          control={
            <PGToggle
              checked={s.pruneOnFetch}
              onChange={(v) => s.set("pruneOnFetch", v)}
            />
          }
        />
      </SettingsCard>

      <SettingsCard
        id="push"
        title="Push safety"
        subtitle="Guardrails around destructive remote operations."
      >
        <SettingsRow
          id="push.confirmForce"
          label="Confirm force-push"
          hint="Ask for confirmation before a force or force-with-lease push."
          control={
            <PGToggle
              checked={s.confirmForcePush}
              onChange={(v) => s.set("confirmForcePush", v)}
            />
          }
        />
      </SettingsCard>

      <SettingsCard
        id="rebase"
        title="Rebase"
        subtitle="How a rebase treats branches that point inside the replayed range."
      >
        <SettingsRow
          id="rebase.updateRefs"
          label="Move dependent branches"
          hint="When rebasing, also move branches whose tips sit inside the range being replayed — git's rebase --update-refs, the thing that keeps a stack of small PRs from being orphaned. Follow git config uses this repository's own rebase.updateRefs. You are always asked first, and told which branches will move."
          control={
            <PGSelect
              data-testid="rebase-update-refs"
              value={s.rebaseUpdateRefs}
              onChange={(v) => s.set("rebaseUpdateRefs", v as UpdateRefsMode)}
              options={[
                { value: "config", label: "Follow git config" },
                { value: "always", label: "Always" },
                { value: "never", label: "Never" },
              ]}
            />
          }
        />
      </SettingsCard>
    </>
  );
}
