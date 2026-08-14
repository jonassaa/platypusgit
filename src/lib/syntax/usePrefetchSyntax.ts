import React from "react";
import {
  readFileContent,
  readFileContentAtIndex,
  readFileContentAtRev,
} from "@/lib/tauri";
import { tokenizeFile } from "./tokenize";
import type { SideSource } from "./useDiffSyntax";

/**
 * How many of a commit's other files to warm.
 *
 * Each one costs an IPC read, so this stays small: a 200-file commit must not
 * fire 200 reads. With tokenization already off the main thread this is a
 * latency nicety, not the fix for jank, so it does not need to be exhaustive.
 */
export const PREFETCH_MAX = 4;

/**
 * Warm the token cache for the files a user is likely to open next.
 *
 * Runs at idle so it never competes with the file actually selected, and
 * abandons the rest of the list when the commit or selection changes — a
 * superseded prefetch that kept going would evict the file being looked at from
 * a 24-entry cache.
 *
 * Sequential rather than parallel on purpose: the point is to use spare time, and
 * four concurrent reads plus four queued tokenize jobs would compete with the
 * selected file for both the IPC thread and the worker.
 */
export function usePrefetchSyntax(o: {
  repoId: string | null;
  /** Candidate paths in list order. The FIRST is skipped as already loading. */
  paths: string[];
  source: SideSource;
  enabled: boolean;
}): void {
  const { repoId, enabled } = o;
  const kind = o.source.kind;
  const rev = o.source.kind === "rev" ? o.source.rev : null;
  // Joined to a primitive: callers rebuild the array every render, so depending
  // on its identity would restart the prefetch on every render.
  const key = o.paths.join("\n");

  React.useEffect(() => {
    if (!enabled || !repoId || kind === "none") return;
    const targets = key.split("\n").filter(Boolean).slice(1, 1 + PREFETCH_MAX);
    if (targets.length === 0) return;
    let cancelled = false;

    const read = (p: string) => {
      if (kind === "worktree") return readFileContent(repoId, p);
      if (kind === "index") return readFileContentAtIndex(repoId, p);
      return rev ? readFileContentAtRev(repoId, rev, p) : Promise.resolve(null);
    };

    const run = async () => {
      for (const p of targets) {
        if (cancelled) return;
        try {
          const c = await read(p);
          if (cancelled || !c?.text) continue;
          await tokenizeFile(p, c.text);
        } catch {
          // A prefetch failure is not user-visible. Opening the file for real
          // will surface it through the normal read path.
        }
      }
    };

    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => void run())
        : setTimeout(() => void run(), 0);

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idle as number);
      } else {
        clearTimeout(idle as ReturnType<typeof setTimeout>);
      }
    };
  }, [repoId, kind, rev, key, enabled]);
}
