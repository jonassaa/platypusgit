import { PGInput, PGSelect, PGToggle } from "@/design";
import {
  DEFAULT_TICKET_PATTERN,
  isValidTicketPattern,
} from "@/features/commits/message";
import { IdentityForm } from "@/features/commits/identity/IdentityForm";
import { SavedIdentities } from "@/features/commits/identity/SavedIdentities";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "git.commit",
  group: "git",
  title: "Commit",
  icon: "commit",
  cards: [
    {
      id: "identity",
      title: "Identity",
      subtitle: "Who your commits are recorded as. Unlike everything else here, this is written to your git config — the same user.name and user.email git itself reads.",
      rows: [
        { id: "identity.author", label: "Commit author", keywords: "user.name user.email name email git config scope global" },
        { id: "identity.saved", label: "Saved identities", keywords: "profile persona switch" },
      ],
    },
    {
      id: "commit",
      title: "Commit",
      subtitle: "Defaults applied when creating a new commit.",
      rows: [
        { id: "commit.signoff", label: "Append Signed-off-by", keywords: "dco trailer sign off" },
        { id: "commit.ticket", label: "Ticket pattern", keywords: "issue jira regex prefix branch" },
        { id: "commit.sign", label: "Sign commits", keywords: "gpg ssh signing key gpgsign verify" },
      ],
    },
  ],
};

/**
 * `user.name` / `user.email` (#212) — the one thing on this page that is NOT
 * a platypusgit preference.
 *
 * It is here anyway, and first, because it is the only setting the app cannot
 * work without: git refuses to record a commit until both are set, and until
 * #212 there was nowhere in the app to set them. The subtitle says out loud
 * that this writes git's own config, since the screen's own header promises
 * "preferences are saved locally".
 *
 * Reachable with no repository open, which is why `repoId` is optional all the
 * way down: a user who lands in Settings before opening anything still gets a
 * true answer, from the global + system chain.
 */
export function CommitPage() {
  const s = useSettingsStore();
  const repo = useRepoStore((state) => state.current);

  return (
    <>
      <SettingsCard
        id="identity"
        title="Identity"
        subtitle="Who your commits are recorded as. Unlike everything else here, this is written to your git config — the same user.name and user.email git itself reads."
      >
        <SettingsRow
          id="identity.author"
          label="Commit author"
          hint="git refuses to record a commit without both. The scope control decides whether saving writes this repository's own config or your global one."
          stacked
          control={<IdentityForm repoId={repo?.id ?? null} />}
        />
        <SettingsRow
          id="identity.saved"
          label="Saved identities"
          hint="Keep the identities you switch between — a work address and a personal one. Applying one writes it to the OPEN repository's config, so git and every hook agree with what you see here. Editing or removing an entry does not change repositories that already use it."
          stacked
          control={<SavedIdentities repoId={repo?.id ?? null} />}
        />
      </SettingsCard>

      <SettingsCard
        id="commit"
        title="Commit"
        subtitle="Defaults applied when creating a new commit."
      >
        <SettingsRow
          id="commit.signoff"
          label="Append Signed-off-by"
          hint="Appends a DCO-style trailer to every commit message."
          control={
            <PGToggle
              checked={s.addSignoff}
              onChange={(v) => s.set("addSignoff", v)}
            />
          }
        />
        <SettingsRow
          id="commit.ticket"
          label="Ticket pattern"
          hint={
            <>
              Regular expression run over the BRANCH NAME to find a ticket key
              the commit composer offers as a one-click insert (#252). Capture
              group 1 wins when the pattern has one, so{" "}
              <code>issue-(\d+)</code> inserts just the number. Leave it empty
              for no chip. Nothing is inserted automatically.
            </>
          }
          control={
            <PGInput
              value={s.commitTicketPattern}
              onChange={(v) => s.set("commitTicketPattern", v)}
              // A pattern that will not compile means no chip and no
              // explanation, so the field says so while it is being typed.
              // `aria-invalid` alongside `error` because PGInput's `error` is
              // a border colour and nothing more — adding the attribute to the
              // shared primitive would restate the semantics of every input in
              // the app in a change that is not about that.
              error={!isValidTicketPattern(s.commitTicketPattern)}
              aria-invalid={!isValidTicketPattern(s.commitTicketPattern)}
              mono
              size="sm"
              placeholder={DEFAULT_TICKET_PATTERN}
              style={{ width: 220 }}
              data-testid="settings-ticket-pattern"
            />
          }
        />
        <SettingsRow
          id="commit.sign"
          label="Sign commits"
          hint="Uses gpg.format, user.signingkey and gpg.program. Following git config respects commit.gpgsign per repository; a signing failure fails the commit rather than producing an unsigned one."
          control={
            <PGSelect
              value={s.signCommits}
              onChange={(v) =>
                s.set("signCommits", v as "config" | "always" | "never")
              }
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
