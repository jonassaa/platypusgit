// The committer identity, loaded for display (#233).
//
// Separate from `IdentityForm`'s own load on purpose. That one seeds editable
// fields ONCE per mount and must not re-seed, or it would wipe what the user is
// typing; this one is read-only and wants the opposite — it re-reads whenever
// something might have changed it, because a stale "committing as" line is
// worse than none. Two needs, two loads, no shared state to get wrong.
//
// Not in `useRepoStore`: the identity is not per-repository state the app
// mutates and coordinates, it is a fact about git config that two surfaces
// read. Putting it in `RepoSlice` would mean an `emptySlice` entry, a tab-switch
// invalidation and a refresh path, all to cache a config read that takes
// microseconds.

import * as React from "react";

import { getIdentity } from "@/lib/tauri";
import type { GitIdentity } from "@/lib/types";

export interface UseIdentity {
  /** `null` until the first read lands, or if it failed. */
  identity: GitIdentity | null;
  /** Re-read — call after anything that may have written git config. */
  reload: () => void;
}

export function useIdentity(repoId: string | null | undefined): UseIdentity {
  const [identity, setIdentity] = React.useState<GitIdentity | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await getIdentity(repoId ?? null);
        if (alive) setIdentity(next);
      } catch {
        // Silent. This drives an informational line, and a repository whose
        // config cannot be read has a louder problem than a missing byline —
        // the commit itself will fail, with `NoSignature` and a form to fix it.
        if (alive) setIdentity(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [repoId, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return { identity, reload };
}

/**
 * `Name <email>` as the commit will record it, or `null` when git has no
 * identity it would accept.
 *
 * Blank-but-present counts as absent, matching `GitIdentity::usable` in Rust —
 * a `user.email =` line is exactly the state that fails at commit time, and
 * rendering `Ada <>` would present it as fine.
 */
export function identityLine(identity: GitIdentity | null): string | null {
  const name = identity?.name?.value.trim();
  const email = identity?.email?.value.trim();
  if (!name || !email) return null;
  return `${name} <${email}>`;
}

/**
 * Where the identity comes from, in the words the scope control uses — so the
 * byline and the form cannot describe the same state differently.
 *
 * `null` when the two halves disagree about scope. That is a real state on a
 * managed machine (`user.name` from `/etc/gitconfig`, `user.email` from
 * `~/.gitconfig`), and naming only the first would be a confident wrong answer
 * about the second; the form says the full story when the user opens it.
 */
export function identityOrigin(identity: GitIdentity | null): string | null {
  const a = identity?.name?.scope;
  const b = identity?.email?.scope;
  if (!a || !b || a !== b) return null;
  switch (a) {
    case "repository":
      return "this repository";
    case "system":
      return "this machine";
    default:
      return "global";
  }
}
