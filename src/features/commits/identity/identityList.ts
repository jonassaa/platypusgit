// Named identities (#233) — a work address and a personal one, kept somewhere
// you can pick between them.
//
// ## Why there is no repo → identity map
//
// The obvious design is a table of `repoId → identityId`, and it is wrong. git
// already stores which identity a repository uses: it is `user.name` /
// `user.email` in that repository's own config, and the CLI, every hook, and
// every other git tool read it. A second store of the same fact drifts the
// moment anyone runs `git config user.email` in a terminal, and then the app
// confidently shows an identity the next commit will not use.
//
// So the saved list is a PALETTE, not an assignment. Applying an entry writes
// the repository's local config — which is what the issue asks for ("with the
// chosen one written to the repo's local config so the CLI agrees with us") —
// and "which one is active here" is answered by reading git config back and
// matching, never by remembering. The consequence worth knowing: an identity
// edited or deleted here does not change any repository that already uses it.
// That is correct — deleting a bookmark does not move the page — and the UI
// says so.

/** One saved identity. */
export interface SavedIdentity {
  /** Stable across renames; what the UI keys on. */
  id: string;
  /** What the user calls it: "Work", "Personal", "OSS". */
  label: string;
  name: string;
  email: string;
}

/**
 * Signing keys are deliberately not here yet.
 *
 * The issue lists one as optional, and hanging a key off an identity is the
 * right shape — but `signCommits` is a global tri-state today (#61 D6) and the
 * signing chain resolves its key from git config. Adding a field nothing reads
 * would be dead weight that later has to be migrated; wiring it properly is its
 * own change.
 */
export const SIGNING_KEY_IS_A_FOLLOW_UP = true;

let seq = 0;

/** A fresh id. Time-based so two entries added in one session cannot collide. */
export function newIdentityId(): string {
  seq += 1;
  return `id-${Date.now().toString(36)}-${seq}`;
}

/** Trim, and answer whether this is worth saving at all. */
export function normalizeIdentity(entry: SavedIdentity): SavedIdentity {
  return {
    ...entry,
    label: entry.label.trim(),
    name: entry.name.trim(),
    email: entry.email.trim(),
  };
}

/**
 * Whether an entry can be saved.
 *
 * Blankness only. Everything beyond it — a `<`, a line break — is the
 * BACKEND's rule (`validate_identity`), and duplicating it here would create a
 * second place for "what git accepts" to drift. The refusal from an actual save
 * names the offending character; this just stops an obviously empty row.
 */
export function isSavableIdentity(entry: SavedIdentity): boolean {
  const e = normalizeIdentity(entry);
  return e.label !== "" && e.name !== "" && e.email !== "";
}

/**
 * The saved entry that matches what git currently resolves to, or null.
 *
 * Matched on name AND email, not on the label: the label is ours, the pair is
 * git's, and a repository configured by hand or by another tool should still
 * light up the entry it corresponds to. Comparison is trimmed, and the email is
 * case-insensitive — addresses are, and `Ada@Example.com` in one place and
 * `ada@example.com` in the other is the same person, not an unmatched identity.
 */
export function activeIdentity(
  saved: readonly SavedIdentity[],
  current: { name: string | null | undefined; email: string | null | undefined },
): SavedIdentity | null {
  const name = (current.name ?? "").trim();
  const email = (current.email ?? "").trim().toLowerCase();
  if (!name || !email) return null;
  return (
    saved.find(
      (s) =>
        s.name.trim() === name && s.email.trim().toLowerCase() === email,
    ) ?? null
  );
}

/** Add or replace by id, preserving order. */
export function upsertIdentity(
  list: readonly SavedIdentity[],
  entry: SavedIdentity,
): SavedIdentity[] {
  const next = normalizeIdentity(entry);
  const i = list.findIndex((s) => s.id === next.id);
  if (i === -1) return [...list, next];
  const copy = [...list];
  copy[i] = next;
  return copy;
}

export function removeIdentity(
  list: readonly SavedIdentity[],
  id: string,
): SavedIdentity[] {
  return list.filter((s) => s.id !== id);
}
