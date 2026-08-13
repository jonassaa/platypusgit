import * as React from "react";

export interface PGSkeletonProps {
  /** CSS width. Defaults to filling the container. */
  width?: number | string;
  /** CSS height, ignored when `rowStep` is set. */
  height?: number | string;
  /** Corner radius, px. */
  radius?: number;
  /** How many stacked placeholders to render. Values below 1 render one. */
  count?: number;
  /** Gap between stacked placeholders, px. */
  gap?: number;
  /**
   * Size each placeholder as a plain list row honouring the UI-density
   * setting. A skeleton row that ignores density is a different height from
   * the real row it stands in for, so the list visibly jumps when data
   * arrives. `--row-h` is already `calc(24px + var(--row-step))`, so it is
   * used directly — adding `var(--row-step)` on top would double-count.
   */
  rowStep?: boolean;
  style?: React.CSSProperties;
}

/**
 * Shimmering placeholder blocks for content that is loading.
 *
 * Presentational only — callers decide when to show it. Uses the `.pg-shimmer`
 * keyframe from index.css, which is suppressed under
 * `prefers-reduced-motion: reduce`.
 */
export function PGSkeleton({
  width = "100%",
  height = 12,
  radius = 3,
  count = 1,
  gap = 6,
  rowStep = false,
  style,
}: PGSkeletonProps) {
  const blockHeight = rowStep ? "var(--row-h)" : height;
  const n = Math.max(1, Math.floor(count));

  const blocks = Array.from({ length: n }, (_, i) => (
    <div
      key={i}
      data-testid="pg-skeleton"
      aria-hidden="true"
      className="pg-shimmer"
      style={{
        width,
        height: blockHeight,
        borderRadius: radius,
        flexShrink: 0,
        ...style,
      }}
    />
  ));

  if (n === 1) return blocks[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {blocks}
    </div>
  );
}
