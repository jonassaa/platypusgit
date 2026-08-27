// The pure half of image previews (#224).
//
// Everything a preview panel decides that is not React lives here, for the same
// reason `lib/derive.ts` exists: four diff surfaces render the same thing, and a
// rule they each re-implement is a rule they eventually disagree about.

import { formatBytes } from "@/lib/bytes";
import type { ImagePreview, ImageSource } from "@/lib/types";
import type { SideSource } from "@/lib/syntax";

/** Pixel dimensions, as the webview reported them once the image decoded. */
export interface ImageDims {
  w: number;
  h: number;
}

/**
 * The `src` for a preview.
 *
 * A `data:` URL, built from base64 the backend already produced — the bytes
 * never leave this machine, and a preview makes no request of any kind (#226).
 * There is no decode on this side: the base64 goes into the `src` verbatim.
 */
export function previewDataUrl(p: Extract<ImagePreview, { kind: "image" }>): string {
  return `data:${p.mediaType};base64,${p.data}`;
}

/**
 * Is this side worth showing a preview panel for?
 *
 * `unsupported / notAnImage` is NOT — that is a PDF, a font, an archive, an
 * executable, every binary #224 explicitly left out of scope — and neither is an
 * absent side on its own. Those keep the surface's existing empty state, which
 * is the honest answer: a broken `<img>` is worse than a sentence.
 *
 * An SVG refusal IS notable, because it is a decision rather than a gap and has
 * to be able to say so; rendering nothing would read as a bug.
 */
export function isNotablePreview(p: ImagePreview | null | undefined): boolean {
  if (!p) return false;
  if (p.kind === "unsupported") return p.reason === "svg";
  return true;
}

/** Any side that actually decoded into an image. */
export function hasImage(previews: readonly (ImagePreview | null)[]): boolean {
  return previews.some((p) => p?.kind === "image");
}

/** "512 × 512", or null while the image has not decoded yet. */
export function formatDims(d: ImageDims | null | undefined): string | null {
  if (!d || !d.w || !d.h) return null;
  return `${d.w} × ${d.h}`;
}

/** "512 × 512 · 24.1 KB" — one panel's caption. */
export function describeSide(size: number, dims: ImageDims | null | undefined): string {
  const px = formatDims(dims);
  return px ? `${px} · ${formatBytes(size)}` : formatBytes(size);
}

/** A signed byte delta: "+64.2 KB", "−1.5 MB", or "no size change". */
export function describeByteDelta(oldSize: number, newSize: number): string {
  const d = newSize - oldSize;
  if (d === 0) return "no size change";
  // U+2212 MINUS, matching the diff gutter's `−`, not a hyphen.
  return `${d > 0 ? "+" : "−"}${formatBytes(Math.abs(d))}`;
}

/**
 * The line under a two-sided preview: what changed, in both currencies.
 *
 * `null` unless BOTH sides decoded — a delta needs two numbers, and inventing
 * one from an added file's missing side is how "+100%" gets printed for a file
 * that never had a previous version.
 */
export function describeDelta(
  oldSide: { size: number; dims?: ImageDims | null } | null,
  newSide: { size: number; dims?: ImageDims | null } | null,
): string | null {
  if (!oldSide || !newSide) return null;
  const parts: string[] = [];
  const a = formatDims(oldSide.dims);
  const b = formatDims(newSide.dims);
  if (a && b) parts.push(a === b ? a : `${a} → ${b}`);
  parts.push(
    oldSide.size === newSide.size
      ? formatBytes(newSide.size)
      : `${formatBytes(oldSide.size)} → ${formatBytes(newSide.size)} (${describeByteDelta(
          oldSide.size,
          newSide.size,
        )})`,
  );
  return parts.join(" · ");
}

/**
 * The same side a diff surface already told the syntax highlighter about.
 *
 * Every surface computes a `SideSource` for `useDiffSyntax`; deriving the image
 * source from it means the preview and the highlighted text can never disagree
 * about which revision they are showing. `none` maps to `null` — that side does
 * not exist.
 */
export function imageSourceFromSide(side: SideSource): ImageSource | null {
  switch (side.kind) {
    case "none":
      return null;
    case "worktree":
      return { kind: "worktree" };
    case "index":
      return { kind: "index" };
    case "rev":
      return { kind: "rev", revspec: side.rev };
  }
}
