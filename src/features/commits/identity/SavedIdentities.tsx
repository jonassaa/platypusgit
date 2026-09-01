// The saved-identity list (#233).
//
// Sits under `IdentityForm` in Settings, and does one thing the form cannot:
// let you keep more than one identity around and switch a repository between
// them in a click.
//
// Applying an entry writes the REPOSITORY's config, never the global one. That
// is the whole point of the feature — a work address on the work repositories
// and a personal one everywhere else — and it is also the safe direction: a
// mis-click changes one repository, not every repository on the machine. The
// global identity stays `IdentityForm`'s job, where the scope control makes it
// an explicit choice.

import * as React from "react";

import { PGButton, PGIcon, PGInput } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { appErrorMessage } from "@/lib/errors";
import { setIdentity } from "@/lib/tauri";

import { useIdentity } from "./useIdentity";
import {
  activeIdentity,
  isSavableIdentity,
  newIdentityId,
  normalizeIdentity,
  removeIdentity,
  upsertIdentity,
  type SavedIdentity,
} from "./identityList";

export interface SavedIdentitiesProps {
  /** The open repository, or null in Settings with nothing open. */
  repoId?: string | null;
}

const blank = (): SavedIdentity => ({
  id: newIdentityId(),
  label: "",
  name: "",
  email: "",
});

export function SavedIdentities({ repoId }: SavedIdentitiesProps) {
  const identities = useSettingsStore((s) => s.identities);
  const setSetting = useSettingsStore((s) => s.set);
  const { identity, reload } = useIdentity(repoId ?? null);

  const [draft, setDraft] = React.useState<SavedIdentity | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState<string | null>(null);

  const active = activeIdentity(identities, {
    name: identity?.name?.value,
    email: identity?.email?.value,
  });

  async function apply(entry: SavedIdentity) {
    if (!repoId) return;
    setApplying(entry.id);
    setError(null);
    try {
      await setIdentity(entry.name, entry.email, "repository", repoId);
      // Re-read rather than assume: this is what proves the write landed, and
      // it is what lights up the "in use here" mark.
      reload();
    } catch (e) {
      setError(appErrorMessage(e));
    } finally {
      setApplying(null);
    }
  }

  function save() {
    if (!draft || !isSavableIdentity(draft)) return;
    setSetting("identities", upsertIdentity(identities, normalizeIdentity(draft)));
    setDraft(null);
  }

  return (
    <div
      data-testid="saved-identities"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {identities.length === 0 && !draft && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
          No saved identities yet. Save the ones you switch between — a work
          address and a personal one — and applying one writes it to the open
          repository&rsquo;s own config.
        </div>
      )}

      {identities.map((entry) =>
        draft?.id === entry.id ? (
          <IdentityEditor
            key={entry.id}
            draft={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <div
            key={entry.id}
            data-testid="saved-identity-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{entry.label}</span>
                {active?.id === entry.id && (
                  <span
                    data-testid="saved-identity-active"
                    title="This repository's commits are recorded as this identity"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: "var(--fs-10)",
                      color: "var(--fg-2)",
                    }}
                  >
                    <PGIcon name="check" size={10} />
                    in use here
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-11)",
                  color: "var(--fg-3)",
                  overflowWrap: "anywhere",
                }}
              >
                {entry.name} &lt;{entry.email}&gt;
              </div>
            </div>
            <PGButton
              size="xs"
              variant="outline"
              // Only meaningful with a repository open: the backend refuses
              // repository scope without one, so an enabled button here would
              // be an offer that cannot be kept.
              disabled={!repoId || applying !== null || active?.id === entry.id}
              title={
                !repoId
                  ? "Open a repository to apply an identity to it"
                  : active?.id === entry.id
                    ? "Already in use in this repository"
                    : `Write ${entry.name} <${entry.email}> to this repository's config`
              }
              onClick={() => void apply(entry)}
              data-testid="saved-identity-apply"
            >
              {applying === entry.id ? "Applying…" : "Use here"}
            </PGButton>
            <PGButton
              size="xs"
              variant="ghost"
              icon="edit"
              title="Edit"
              onClick={() => setDraft(entry)}
              data-testid="saved-identity-edit"
            />
            <PGButton
              size="xs"
              variant="ghost"
              icon="trash"
              title="Remove from the list. Repositories already using it are not changed."
              onClick={() => setSetting("identities", removeIdentity(identities, entry.id))}
              data-testid="saved-identity-remove"
            />
          </div>
        ),
      )}

      {draft && !identities.some((e) => e.id === draft.id) && (
        <IdentityEditor
          draft={draft}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      )}

      {!draft && (
        <div>
          <PGButton
            size="xs"
            variant="outline"
            icon="plus"
            onClick={() => setDraft(blank())}
            data-testid="saved-identity-add"
          >
            Add identity
          </PGButton>
        </div>
      )}

      {error && (
        <div
          data-testid="saved-identity-error"
          style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function IdentityEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: SavedIdentity;
  onChange: (d: SavedIdentity) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="saved-identity-editor"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
    >
      <PGInput
        value={draft.label}
        onChange={(v) => onChange({ ...draft, label: v })}
        placeholder="Work"
        size="sm"
        aria-label="Label"
        data-testid="saved-identity-label-input"
        style={{ width: 96 }}
      />
      <PGInput
        value={draft.name}
        onChange={(v) => onChange({ ...draft, name: v })}
        placeholder="Ada Lovelace"
        size="sm"
        aria-label="Name"
        data-testid="saved-identity-name-input"
        style={{ flex: "1 1 140px", minWidth: 0 }}
      />
      <PGInput
        value={draft.email}
        onChange={(v) => onChange({ ...draft, email: v })}
        placeholder="ada@example.com"
        size="sm"
        mono
        aria-label="Email"
        data-testid="saved-identity-email-input"
        style={{ flex: "1 1 180px", minWidth: 0 }}
      />
      <PGButton
        size="xs"
        variant="primary"
        // Blankness only — everything git refuses beyond that is the backend's
        // rule, and it names the offending character when a save is attempted.
        disabled={!isSavableIdentity(draft)}
        onClick={onSave}
        data-testid="saved-identity-save"
      >
        Save
      </PGButton>
      <PGButton size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </PGButton>
    </div>
  );
}
