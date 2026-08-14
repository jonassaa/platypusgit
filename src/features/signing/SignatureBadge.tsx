import React from "react";
import { PGIcon } from "@/design";
import { verifyCommit } from "@/lib/tauri";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { SigState, SignatureStatus } from "@/lib/types";

/** Colour + glyph + wording for each verdict. */
const LOOK: Record<
  SigState,
  { icon: string; color: string; label: string } | null
> = {
  Good: { icon: "check", color: "var(--git-added)", label: "Signed" },
  Bad: { icon: "warn", color: "var(--git-removed)", label: "Bad signature" },
  UnknownKey: {
    icon: "lock",
    color: "var(--fg-2)",
    label: "Signed, key unavailable",
  },
  Expired: { icon: "warn", color: "var(--git-modified)", label: "Signature expired" },
  Revoked: { icon: "warn", color: "var(--git-removed)", label: "Key revoked" },
  // Unsigned is the overwhelming majority of commits in most repos; a badge on
  // every one of them would be noise, so it renders nothing.
  None: null,
};

/**
 * Settle time before verifying, matching the inline commit diff rendered beside
 * this badge in the same panel (History's INLINE_DIFF_DEBOUNCE_MS).
 *
 * `verify_commit` shells out to `git show`, so without this, arrowing through the
 * log spawns one process per row passed over — all of them still queued behind
 * `spawn_blocking` after the user has stopped moving.
 */
const VERIFY_DEBOUNCE_MS = 100;

/**
 * Signature status of one commit (#61 D6).
 *
 * Verifies **lazily, for this commit only** — a badge on every log row would
 * mean a gpg/ssh-keygen process per walked commit, which fights the paginated
 * log walk and the windowed list.
 */
export function SignatureBadge({ oid }: { oid: string }) {
  const repoId = useRepoStore((s) => s.current?.id ?? null);
  const [status, setStatus] = React.useState<SignatureStatus | null>(null);

  React.useEffect(() => {
    if (!repoId || !oid) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    setStatus(null);
    const handle = window.setTimeout(() => {
      verifyCommit(repoId, oid)
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          // A verification failure is not worth an error banner: the commit and
          // its diff are still perfectly viewable.
          if (!cancelled) setStatus(null);
        });
    }, VERIFY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [repoId, oid]);

  const look = status ? LOOK[status.state] : null;
  if (!look) return null;

  const title = [look.label, status?.signer, status?.key]
    .filter(Boolean)
    .join(" — ");

  return (
    <span
      data-testid="signature-badge"
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        color: look.color,
        fontSize: "var(--fs-10)",
      }}
    >
      <PGIcon name={look.icon} size={11} />
      {look.label}
    </span>
  );
}
