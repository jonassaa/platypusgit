// Fetching the bytes behind an image preview (#224).
//
// ONE hook for every diff surface, for the same reason `useDiffFind` is one hook
// (#241) and `LfsDiffNotice` is one component (#93): the same file must not read
// differently depending on which pane you opened it in.

import React from "react";
import { readImagePreview } from "@/lib/tauri";
import { imageSourceFromSide } from "@/lib/imagePreview";
import type { SideSource } from "@/lib/syntax";
import type { ImagePreview, ImageSource } from "@/lib/types";

/** One panel's worth of "where do these bytes come from, and what to call it". */
export interface ImageSide {
  /** Stable identity across renders. Also the panel's test id suffix. */
  key: string;
  /** Panel heading — "Old"/"New", "Ours"/"Theirs", "File". */
  label: string;
  /** Diff tone for the heading. `neutral` for a chooser or a single file. */
  tone?: "removed" | "added" | "neutral";
  source: ImageSource;
  /**
   * Path on THIS side. A rename has a different old path, and reading the new
   * one against the old tree would come back empty — the same trap
   * `useDiffSyntax` documents for its `rev` source.
   */
  path?: string | null;
}

export interface ImagePreviews {
  /** One entry per side, in the order given. `null` = no blob on that side. */
  previews: (ImagePreview | null)[];
  loading: boolean;
}

const NONE: ImagePreviews = { previews: [], loading: false };

/**
 * Read every side's bytes, once per selection.
 *
 * **Nothing is fetched speculatively.** The hook is inert unless `enabled`, and
 * every surface enables it only for the file the user has actually selected —
 * which is the whole reason the ceiling can be as generous as it is.
 *
 * The effect depends on a serialized key rather than on `sides`: callers build
 * that array inline every render, so depending on its identity would re-read
 * both blobs on every keystroke in a filter box.
 */
export function useImagePreviews(o: {
  repoId: string | null;
  path: string | null;
  sides: readonly ImageSide[];
  enabled: boolean;
}): ImagePreviews {
  const { repoId, path, sides, enabled } = o;
  const key = JSON.stringify(
    enabled && repoId && path
      ? [repoId, path, sides.map((s) => [s.key, s.source, s.path ?? null])]
      : null,
  );
  const [state, setState] = React.useState<ImagePreviews>(NONE);

  React.useEffect(() => {
    const spec = JSON.parse(key) as
      | [string, string, [string, ImageSource, string | null][]]
      | null;
    if (!spec) {
      setState(NONE);
      return;
    }
    const [rid, p, wanted] = spec;
    let cancelled = false;
    setState({ previews: wanted.map(() => null), loading: true });
    Promise.all(
      wanted.map(([, source, sidePath]) =>
        // A rejection here is a real failure (unknown repository, bad revspec)
        // and it must not take the surface down with it — the pane falls back to
        // the empty state it had before this feature existed.
        readImagePreview(rid, source, sidePath ?? p).catch(() => null),
      ),
    ).then((previews) => {
      if (!cancelled) setState({ previews, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

/**
 * The two panels of an ordinary old-vs-new diff.
 *
 * Built from the `SideSource` pair the surface ALREADY computed for syntax
 * highlighting, so the preview and the coloured text can never disagree about
 * which revision they are showing — and a fifth diff surface gets its previews
 * by passing the sides it already had.
 *
 * A side the surface calls `none` is dropped, because there is nothing to read;
 * a side that simply holds no blob is NOT dropped here — the backend answers
 * `null` for that, and the panel says "Added" / "Removed" from the pair.
 */
export function diffImageSides(o: {
  old: SideSource;
  new: SideSource;
  /** The old side's path, when a rename moved it. */
  oldPath?: string | null;
}): ImageSide[] {
  const sides: ImageSide[] = [];
  const oldSource = imageSourceFromSide(o.old);
  if (oldSource) {
    sides.push({
      key: "old",
      label: "Old",
      tone: "removed",
      source: oldSource,
      path: o.oldPath ?? null,
    });
  }
  const newSource = imageSourceFromSide(o.new);
  if (newSource) {
    sides.push({ key: "new", label: "New", tone: "added", source: newSource });
  }
  return sides;
}
