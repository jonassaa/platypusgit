// What a diff surface shows INSTEAD of "Binary file" when the binary is an
// image (#224).
//
// ONE component for every diff surface — the CommitDiffPanel, the DiffViewer,
// the RepoBrowser, the CommitPanel and the merge resolver's binary chooser — so
// the next diff surface inherits it and the same file cannot read differently
// depending on which pane you opened it in. Same rule as `LfsDiffNotice` (#93)
// and `useDiffFind` (#241).
//
// # It renders the empty state too
//
// The fallback is a PROP rather than something each caller wraps this in,
// because "is there anything to preview" is exactly the question this component
// answers. A PDF, a font, an archive — every binary #224 left out of scope —
// keeps the sentence the surface printed before, and each surface keeps its own
// wording by passing it in.
//
// # No measurement, no windowing
//
// Two images in a grid: `auto-fit` collapses to one column when the pane is
// narrow, and `object-fit: contain` inside a fixed max height does the rest. No
// `ResizeObserver` (WebKitGTK has none) and nothing to scroll by offset.

import React from "react";
import { PGEmpty, PGIcon, PGSkeleton, type IconName } from "@/design";
import { formatBytes } from "@/lib/bytes";
import {
  describeDelta,
  describeSide,
  hasImage,
  isNotablePreview,
  previewDataUrl,
  type ImageDims,
} from "@/lib/imagePreview";
import type { ImagePreview } from "@/lib/types";
import { useImagePreviews, type ImageSide } from "./useImagePreviews";

export type { ImageSide } from "./useImagePreviews";

/**
 * Transparency has to be visible in BOTH themes, and an icon exported on a white
 * artboard has to be distinguishable from one with an alpha channel. A
 * checkerboard built from the surface tokens does that and inherits the theme —
 * light themes became reachable at runtime in #236, and a hardcoded grey would
 * be a hole in one of them. No accent hue anywhere near this.
 */
const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "var(--bg-1)",
  backgroundImage:
    "conic-gradient(var(--bg-2) 0 25%, transparent 0 50%, var(--bg-2) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0",
};

const toneColor = (tone: ImageSide["tone"]) =>
  tone === "removed"
    ? "var(--git-removed)"
    : tone === "added"
      ? "var(--git-added)"
      : "var(--fg-2)";

/**
 * One panel's sentence and the glyph beside it.
 *
 * `icon` is `IconName`, NOT `string`: `PGIconProps.name` widens to
 * `IconName | string` so a typo type-checks into a dashed square, and
 * `test/iconSet.test.ts` only scans `name="…"`/`icon="…"` ATTRIBUTES — an icon
 * named in an object literal like these escapes both gates unless it is typed
 * here.
 */
type PanelNote = { icon: IconName; text: string };

/** The sentence a non-image side gets inside a panel. */
function noteFor(p: ImagePreview | null): PanelNote | null {
  if (!p) return null;
  switch (p.kind) {
    case "image":
      return null;
    case "tooLarge":
      return {
        icon: "warn",
        text: `Too large to preview — ${formatBytes(p.size)} (limit ${formatBytes(p.limit)})`,
      };
    case "lfsMissing":
      return {
        icon: "lfs",
        // The point of the LFS branch: git holds a three-line pointer, and
        // rendering THAT would put text where an image belongs.
        text: `LFS object not fetched — ${formatBytes(p.size)}. Run “LFS fetch” to preview it.`,
      };
    case "unsupported": {
      switch (p.reason) {
        case "svg":
          return {
            icon: "warn",
            // Refusing SVG is a decision, not a gap — see git/image.rs. Saying
            // nothing here would read as a bug.
            text: "SVG previews are disabled — an SVG can carry script and remote references.",
          };
        case "truncated":
          return {
            icon: "warn",
            // The backend proved this from the file's own structure, so the
            // sentence can name the cause. A webview could not: it decodes the
            // prefix, fires `load` and paints part of a picture (see
            // `git/image.rs::integrity`).
            text: `Truncated image — ${formatBytes(p.size)} present, and the file ends mid-way through its image data.`,
          };
        case "notAnImage":
          return { icon: "file", text: "Not an image we can preview." };
      }
      // A new reason must get its own sentence here: showing nothing and
      // saying nothing is the one outcome this surface is written against.
      const unreachedReason: never = p.reason;
      return unreachedReason;
    }
  }
}

/**
 * What a side shows once THIS ENGINE has refused bytes the backend vouched for.
 *
 * Narrow on purpose, and narrower than it looks. `onError` does NOT fire for a
 * truncated or damaged file: measured in Blink 152, a PNG cut to 60% and one
 * with an overwritten IDAT both fire `load`, report the intact header's
 * dimensions and paint a partial or blank picture. Those are refused in the
 * backend instead (`UnsupportedReason::Truncated`) and never get here. What is
 * left for `onError` is the one thing only the engine knows: a structurally
 * complete file this webview will not display — an exotic BMP or ICO variant,
 * an animated WebP feature.
 *
 * So the sentence names no cause. The app runs on WKWebView, WebView2 and
 * WebKitGTK, whose format coverage differs, and telling someone their asset is
 * corrupt when it opens fine on a colleague's machine is the same dishonesty
 * `git/image.rs`'s doc is written against (#212).
 */
const UNDECODABLE = {
  icon: "warn",
  text: "This image could not be displayed — its format is not supported here.",
} as const satisfies PanelNote;

function ImagePanel({
  side,
  preview,
  dims,
  onDims,
  failed,
  onFail,
}: {
  side: ImageSide;
  preview: ImagePreview | null;
  dims: ImageDims | null;
  onDims: (key: string, data: string, d: ImageDims) => void;
  failed: boolean;
  onFail: (key: string, data: string) => void;
}) {
  // A side that failed to decode keeps its size caption (the byte count came
  // from the backend, not from the decoder) and trades the picture for a
  // sentence. `failed` is only ever true for an image preview — the parent
  // derives it from the bytes this panel is rendering — so it cannot shadow
  // the more specific sentence a `tooLarge` or `lfsMissing` side has earned.
  const note = failed ? UNDECODABLE : noteFor(preview);
  return (
    <div
      data-testid={`image-panel-${side.key}`}
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          fontSize: "var(--fs-11)",
          minWidth: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: toneColor(side.tone) }}>{side.label}</span>
        <span
          data-testid={`image-caption-${side.key}`}
          style={{
            color: "var(--fg-2)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {preview ? describeSide(preview.size, dims) : "—"}
        </span>
      </div>
      <div
        style={{
          ...CHECKERBOARD,
          border: "1px solid var(--border-0)",
          borderRadius: "var(--r-3)",
          minHeight: 72,
          padding: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {preview?.kind === "image" && !failed ? (
          <img
            data-testid={`image-preview-${side.key}`}
            // A `data:` URL over bytes the backend already read. Local, always:
            // a preview issues no request of any kind (#226).
            src={previewDataUrl(preview)}
            alt={`${side.label} version of ${preview.path}`}
            onLoad={(e) =>
              onDims(side.key, preview.data, {
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() => onFail(side.key, preview.data)}
            // The box only ever SHRINKS an image (`max-*`, never a width), so
            // a 16×16 favicon renders at 16×16 and a screenshot is scaled down.
            // Deliberately no `image-rendering: pixelated`: it would only ever
            // apply to the downscale, where it aliases.
            style={{
              maxWidth: "100%",
              maxHeight: "min(48vh, 420px)",
              objectFit: "contain",
            }}
          />
        ) : note ? (
          <div
            data-testid={`image-note-${side.key}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--fg-2)",
              fontSize: "var(--fs-11)",
              textAlign: "center",
            }}
          >
            <PGIcon name={note.icon} size={13} />
            <span>{note.text}</span>
          </div>
        ) : (
          <span
            data-testid={`image-absent-${side.key}`}
            style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}
          >
            No version on this side
          </span>
        )}
      </div>
    </div>
  );
}

export interface ImageDiffViewProps {
  repoId: string | null;
  /** The path being previewed — a side may override it (renames). */
  path: string | null;
  /** One or two sides. Two renders a comparison; one renders a single preview. */
  sides: readonly ImageSide[];
  /**
   * What to render when nothing here is previewable — the surface's own
   * "Binary file" copy. `null` for a surface that already said it another way
   * (an LFS notice above, the merge chooser below).
   */
  fallback?: React.ReactNode;
}

/**
 * Old beside new, each with its pixel dimensions and byte size, and the delta of
 * both. An added or deleted file shows the one side that exists.
 */
export function ImageDiffView({ repoId, path, sides, fallback = null }: ImageDiffViewProps) {
  // The gate that keeps the promise "never load bytes for a file the user has
  // not selected": no path, no read.
  const enabled = !!repoId && !!path;
  const { previews, loading } = useImagePreviews({ repoId, path, sides, enabled });
  // Both of these describe BYTES, not a file, so both record which bytes they
  // came from and are read back by comparison rather than cleared by an effect.
  //
  // A reset effect is what this used to be, keyed on `[path, previewKey]`. That
  // key was narrower than the one `useImagePreviews` reads on: it ignores
  // `repoId` and each side's `source`, and stands in `data.length` for the
  // data. So the same path at a different revision, at an equal byte length,
  // kept the previous blob's state — a caption for the wrong image, or a
  // failure notice printed over a good one. Deriving instead also settles two
  // things a reset could not: it never races the browser's `error` task
  // against a passive effect, and one side's new bytes cannot clear the other
  // side's live failure.
  const [dims, setDims] = React.useState<Record<string, { data: string; d: ImageDims }>>({});
  const [failedData, setFailedData] = React.useState<Record<string, string>>({});
  const onDims = React.useCallback(
    (key: string, data: string, d: ImageDims) =>
      setDims((prev) => {
        const at = prev[key];
        return at?.data === data && at.d.w === d.w && at.d.h === d.h
          ? prev
          : { ...prev, [key]: { data, d } };
      }),
    [],
  );
  const onFail = React.useCallback(
    (key: string, data: string) =>
      setFailedData((prev) => (prev[key] === data ? prev : { ...prev, [key]: data })),
    [],
  );
  /** The measurement for a side, only if it was taken from these exact bytes. */
  const dimsFor = (key: string, p: ImagePreview | null): ImageDims | null =>
    p?.kind === "image" && dims[key]?.data === p.data ? dims[key].d : null;
  /** Did THESE bytes fail? A non-image side can never be in this state. */
  const failedFor = (key: string, p: ImagePreview | null): boolean =>
    p?.kind === "image" && failedData[key] === p.data;
  if (loading) {
    return (
      <div data-testid="image-diff-loading" style={{ padding: 12 }} aria-busy="true">
        <PGSkeleton count={4} height={12} gap={6} />
      </div>
    );
  }
  if (!previews.some(isNotablePreview)) return <>{fallback}</>;

  const delta = describeDelta(
    previews[0]?.kind === "image"
      ? { size: previews[0].size, dims: dimsFor(sides[0].key, previews[0]) }
      : null,
    previews[1]?.kind === "image"
      ? { size: previews[1].size, dims: dimsFor(sides[1].key, previews[1]) }
      : null,
  );
  // "Added" / "Removed" only when there genuinely are two sides and one of them
  // holds nothing — a one-sided view (browsing a tree) is not an add.
  const oneSided =
    sides.length === 2 && hasImage(previews) && previews.some((p) => p == null)
      ? previews[0] == null
        ? "Added — no previous version"
        : "Removed — no new version"
      : null;

  return (
    <div
      data-testid="image-diff"
      style={{ margin: 12, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
          gap: 12,
        }}
      >
        {sides.map((side, i) => (
          <ImagePanel
            key={side.key}
            side={side}
            preview={previews[i] ?? null}
            dims={dimsFor(side.key, previews[i] ?? null)}
            onDims={onDims}
            failed={failedFor(side.key, previews[i] ?? null)}
            onFail={onFail}
          />
        ))}
      </div>
      {oneSided && (
        <div
          data-testid="image-diff-onesided"
          style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
        >
          {oneSided}
        </div>
      )}
      {delta && (
        <div
          data-testid="image-diff-delta"
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

/**
 * The whole-pane version, for surfaces whose binary state IS a `PGEmpty`.
 *
 * Keeps each surface's existing title and copy — the empty state was never the
 * bug, only the fact that an image never got past it.
 */
export function ImageDiffOrEmpty({
  title,
  icon = "file",
  children,
  ...props
}: ImageDiffViewProps & {
  title: React.ReactNode;
  icon?: string;
  children?: React.ReactNode;
}) {
  return (
    <ImageDiffView
      {...props}
      fallback={
        <PGEmpty icon={icon} title={title}>
          {children}
        </PGEmpty>
      }
    />
  );
}
