// Which files the user has said "yes, really, show me" about (#396).
//
// The click on the notice's action does not fetch anything itself. It records a
// WAIVER, and the surface's ordinary diff fetch — which already knows the repo,
// the revisions, the context width and the whitespace flag — carries it. That is
// the whole design, and it is what the first version got wrong: a hook that
// fetched the waived path separately and spliced it in lost the result to the
// next status refresh, because the refresh re-ran the surface's own fetch
// WITHOUT the waiver. The user clicked, waited seconds for 40 MB to be read, and
// watched the refusal come back on its own.
//
// So the backend's diff ops answer with the whole diff and the waived paths read
// at the raised ceiling (`with_raised`, `libgit2.rs`), and every fetch passes
// `raiseFor`. What is left here is the state and its lifetime:
//
//   * **Per file.** `raiseFor` holds only paths the user actually clicked, both
//     sides of a rename, and the backend raises the ceiling for those alone —
//     waiving one 40 MB blob never reads the 60 MB one beside it.
//   * **Per view, never a setting.** Component state, dropped whenever
//     `resetKey` changes — the selected file, or the commit being shown. A
//     remembered "always diff huge files" is a considered refusal turned into a
//     footgun the user forgot they armed, so navigating away and back costs
//     another click rather than another silent 40 MB read.

import React from "react";
import type { FileDiff } from "@/lib/types";

/**
 * The paths to waive for one delta: its own, plus the side it was renamed from.
 *
 * Both, because the backend turns the list into a pathspec and a rename is two
 * tree entries — naming only the new side would hand `find_similar` half the
 * pair and turn the rename into an add.
 */
export function raisedPathsFor(diff: FileDiff): string[] {
  return diff.oldPath && diff.oldPath !== diff.path
    ? [diff.path, diff.oldPath]
    : [diff.path];
}

export interface DiffAnyway {
  /**
   * Paths whose ceiling the user has waived in this view. Pass it to the diff
   * fetch — on EVERY fetch, including the ones a refresh triggers, or the waived
   * read is thrown away by the next one.
   */
  raiseFor: string[];
  /** Record the waiver for one delta. The fetch effect does the reading. */
  diffAnyway: (diff: FileDiff) => void;
}

/**
 * `resetKey` is whatever identifies the diff on screen — the selected file for a
 * single-file surface, the commit or compare target for a multi-file one. When
 * it changes the waivers go with it.
 */
export function useDiffAnyway(resetKey: unknown): DiffAnyway {
  const [raiseFor, setRaiseFor] = React.useState<string[]>([]);

  // Derived during render rather than in an effect: an effect would let one
  // frame commit the previous view's waivers against the new subject, and for a
  // waiver that frame is a megabyte-scale read.
  const prevKey = React.useRef(resetKey);
  if (prevKey.current !== resetKey) {
    prevKey.current = resetKey;
    if (raiseFor.length > 0) setRaiseFor([]);
  }

  const diffAnyway = React.useCallback((diff: FileDiff) => {
    setRaiseFor((prev) => [...new Set([...prev, ...raisedPathsFor(diff)])]);
  }, []);

  return { raiseFor, diffAnyway };
}
