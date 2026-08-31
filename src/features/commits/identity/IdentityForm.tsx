// The committer identity (#212) — one form, two places.
//
// Why this exists at all: `user.name` / `user.email` are the ONLY thing a brand
// new user must configure before the app can do the thing it is for, and until
// #212 there was nowhere in the app to set them. A fresh machine's first commit
// failed with a banner reading "NoSignature" and the app offered nothing to
// click.
//
// Why ONE component for both surfaces: the commit panel's prompt and the
// Settings section ask the identical question, and two forms would drift — one
// would learn that a blank email is refused and the other would not. The
// difference between them is framing, not behaviour, so it is a prop.
//
// Global, not per-repository, deliberately: the state being fixed is a machine
// with no identity at all, and per-repository would ask the same question again
// in every repository the user opens. Per-repository identities and multiple
// accounts are #233; when that lands, this form grows a scope control rather
// than a sibling.

import * as React from "react";

import { PGButton, PGIcon, PGInput } from "@/design";
import { appErrorMessage } from "@/lib/errors";
import { getIdentity, setIdentity } from "@/lib/tauri";
import type { GitIdentity, IdentityScope } from "@/lib/types";

/** Where a value came from, as a user reads it. */
function scopeLabel(scope: IdentityScope): string {
  switch (scope) {
    case "repository":
      return "this repository";
    case "system":
      return "this machine";
    default:
      return "your global git config";
  }
}

/**
 * The identity's current state as one line of prose, or null when there is
 * nothing worth saying.
 *
 * A repo-local value is the one worth naming: saving here writes the GLOBAL
 * config, so a user whose repository overrides it would otherwise save, see no
 * change, and conclude the app is broken.
 */
function currentStateNote(identity: GitIdentity | null): string | null {
  if (!identity) return null;
  const overrides = [
    identity.name?.scope === "repository" ? "name" : null,
    identity.email?.scope === "repository" ? "email" : null,
  ].filter(Boolean) as string[];
  if (overrides.length === 0) return null;
  // No issue number in prose a user reads — "#233" means nothing to them, and
  // the sentence has to end with something they can act on instead.
  return `This repository sets its own ${overrides.join(" and ")} in its .git/config, which wins over anything saved here. Saving will not change what this repository's commits are recorded as.`;
}

/**
 * Where the values in the fields came from, as one line — naming BOTH halves
 * when they disagree.
 *
 * They can: `user.name` from `/etc/gitconfig` and `user.email` from
 * `~/.gitconfig` is an ordinary state on a managed machine, and reporting only
 * the first would be a confident wrong answer about the second.
 */
function sourceNote(identity: GitIdentity): string | null {
  const { name, email } = identity;
  if (!name && !email) return null;
  if (name && email) {
    return name.scope === email.scope
      ? `Currently read from ${scopeLabel(name.scope)}.`
      : `Name read from ${scopeLabel(name.scope)}, email from ${scopeLabel(email.scope)}.`;
  }
  const half = name ? "Name" : "Email";
  const only = (name ?? email)!;
  // One half set and the other not is exactly the state git refuses on, so say
  // which one is still missing rather than only where the other came from.
  return `${half} read from ${scopeLabel(only.scope)}; the other is not set.`;
}

export interface IdentityFormProps {
  /** Read the effective identity for this repository; omit for global only. */
  repoId?: string | null;
  /**
   * Called after a successful save. The commit panel retries the commit here;
   * Settings just re-reads.
   */
  onSaved?: () => void;
  /** Label for the confirm button — the one thing the two surfaces differ on. */
  saveLabel?: string;
  autoFocus?: boolean;
}

export function IdentityForm({
  repoId,
  onSaved,
  saveLabel = "Save",
  autoFocus,
}: IdentityFormProps) {
  const [identity, setLoaded] = React.useState<GitIdentity | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // One load per mount. The fields are seeded from it ONCE: re-seeding on every
  // read would wipe what the user is typing the moment anything refreshed.
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await getIdentity(repoId ?? null);
        if (!alive) return;
        setLoaded(next);
        setName(next.name?.value ?? "");
        setEmail(next.email?.value ?? "");
      } catch (e) {
        if (!alive) return;
        // Reading the config failed, which is not the same as having no
        // identity — say so rather than presenting empty fields as the truth.
        setError(appErrorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [repoId]);

  // Mirrors the backend's own precondition, so the button is not offering to do
  // something that will be refused. Everything BEYOND blankness (a `<`, a line
  // break) is left to the backend on purpose — one rule, in one place, and the
  // refusal it returns names the character.
  const canSave = name.trim() !== "" && email.trim() !== "" && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setIdentity(name, email);
      setSaved(true);
      // Re-read rather than assume: this is what proves the write landed where
      // the form said it would, and it picks up a repo-local override that is
      // still winning.
      try {
        setLoaded(await getIdentity(repoId ?? null));
      } catch {
        // The write succeeded; a failed re-read is not worth an error banner
        // over the top of it.
      }
      onSaved?.();
    } catch (e) {
      setError(appErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const note = currentStateNote(identity);
  const target = identity?.globalConfigPath;

  return (
    <div
      data-testid="identity-form"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 160px", minWidth: 0 }}>
          <div style={fieldLabel}>Name</div>
          <PGInput
            value={name}
            onChange={setName}
            placeholder="Ada Lovelace"
            autoFocus={autoFocus}
            data-testid="identity-name"
            aria-label="Name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
        </label>
        <label style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={fieldLabel}>Email</div>
          <PGInput
            value={email}
            onChange={setEmail}
            placeholder="ada@example.com"
            data-testid="identity-email"
            aria-label="Email"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PGButton
          size="sm"
          variant="primary"
          disabled={!canSave}
          onClick={() => void save()}
          data-testid="identity-save"
        >
          {saving ? "Saving…" : saveLabel}
        </PGButton>
        {/* Naming the file is the honest version of "Save": this is a write to
            the user's own git config, outside the app's own settings. */}
        {target && (
          <span
            style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
            data-testid="identity-target"
          >
            Writes user.name and user.email to {target}
          </span>
        )}
      </div>

      {saved && !error && (
        <div
          data-testid="identity-saved"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
          }}
        >
          <PGIcon name="check" size={11} />
          Saved.
        </div>
      )}

      {error && (
        <div
          data-testid="identity-error"
          style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
        >
          {error}
        </div>
      )}

      {note && (
        <div
          data-testid="identity-scope-note"
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            lineHeight: 1.5,
          }}
        >
          {note}
        </div>
      )}

      {/* Where the values in the fields came from, when they came from
          somewhere. Silent on a fresh machine, where there is nothing to
          report and a "not configured" line would just be noise beside two
          empty inputs. */}
      {identity && !note && sourceNote(identity) && (
        <div
          data-testid="identity-source"
          style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
        >
          {sourceNote(identity)}
        </div>
      )}
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  fontSize: "var(--fs-11)",
  color: "var(--fg-3)",
  marginBottom: 3,
};
