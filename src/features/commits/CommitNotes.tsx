import React from "react";

import { PGBadge } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { commitNotes } from "@/lib/tauri";
import type { CommitNote } from "@/lib/types";

/**
 * Settle time before reading notes, matching `SignatureBadge`'s.
 *
 * A notes read is a fanout-tree descent per notes ref, and arrowing through
 * the log otherwise queues one per row passed over — all still behind
 * `spawn_blocking` after the user has stopped moving.
 */
export const NOTES_DEBOUNCE_MS = 100;

/**
 * `git notes` attached to ONE commit (#253). Read-only.
 *
 * # Why this is not part of the log page
 *
 * The log is paged and its walk is the hot path: a notes lookup per walked
 * commit would put a tree descent on every page fetch, for a feature most
 * repositories never use. So notes are read lazily for the SELECTED commit
 * only — the same shape `SignatureBadge` has, and for the same reason. The
 * cost to the log page is exactly zero.
 *
 * # Absence renders nothing
 *
 * Most commits in most repositories have no notes. An "no notes" placeholder
 * would be permanent furniture in the panel, so the component collapses to
 * `null` — as it does when the read fails, which is not worth a banner beside
 * a perfectly viewable commit.
 */
export function CommitNotes({ oid }: { oid: string }) {
  const repoId = useRepoStore((s) => s.current?.id ?? null);
  const [notes, setNotes] = React.useState<CommitNote[]>([]);

  React.useEffect(() => {
    if (!repoId || !oid) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setNotes([]);
    const handle = window.setTimeout(() => {
      commitNotes(repoId, oid)
        .then((n) => {
          if (!cancelled) setNotes(n);
        })
        .catch(() => {
          if (!cancelled) setNotes([]);
        });
    }, NOTES_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [repoId, oid]);

  if (notes.length === 0) return null;

  return (
    <div
      data-testid="commit-notes"
      style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}
    >
      {notes.map((note) => (
        <div
          key={note.refName}
          data-testid="commit-note"
          data-note-ref={note.refName}
          style={{
            border: "1px solid var(--border-1)",
            borderLeft: "2px solid var(--accent)",
            borderRadius: "var(--r-2)",
            background: "var(--bg-1)",
            padding: "6px 8px",
          }}
        >
          <div style={{ marginBottom: 4 }} title={note.refName}>
            {/* The ref is load-bearing: a note on refs/notes/review and one on
                refs/notes/commits are different claims about the commit. */}
            <PGBadge tone="muted" icon="fileDoc">
              {note.label}
            </PGBadge>
          </div>
          <div
            style={{
              color: "var(--fg-1)",
              fontSize: "var(--fs-12)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              lineHeight: 1.5,
            }}
          >
            {note.message}
          </div>
        </div>
      ))}
    </div>
  );
}
