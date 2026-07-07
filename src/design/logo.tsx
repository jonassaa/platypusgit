import type { CSSProperties } from "react";

export interface PGLogoProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
  /** Accessible label. When set, the mark is exposed as an image; otherwise decorative. */
  title?: string;
  "data-testid"?: string;
}

/**
 * PlatypusGit brand mark — the app logo (see src-tauri/icons/logo.svg): a
 * platypus face with a teal head and an orange bill.
 *
 * The two brand fills are driven by themeable CSS vars — `--logo` (head) and
 * `--logo-2` (bill), written by the settings store's applyTheme — so the logo
 * recolors with the active theme and is customizable in the theme editor.
 * Defaults to the brand teal/orange. The eyes stay dark on both fills.
 */
export function PGLogo({
  size = 16,
  style,
  className,
  title,
  "data-testid": testId,
}: PGLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
      data-testid={testId}
      style={{ flexShrink: 0, ...style }}
    >
      {title ? <title>{title}</title> : null}
      {/* head (primary brand color) */}
      <path
        d="M 4 8 Q 4 4 12 4 Q 20 4 20 8 L 20 14 Q 20 15 19 15 L 5 15 Q 4 15 4 14 Z"
        fill="var(--logo)"
      />
      {/* bill (secondary brand color) */}
      <path
        d="M 6 13 L 18 13 Q 19 13 19 14 L 18 19 Q 18 20 17 20 L 7 20 Q 6 20 6 19 L 5 14 Q 5 13 6 13 Z"
        fill="var(--logo-2)"
      />
      {/* nostrils */}
      <rect x="9.5" y="15.5" width="1.2" height="0.8" rx="0.3" fill="#000" opacity="0.35" />
      <rect x="13.3" y="15.5" width="1.2" height="0.8" rx="0.3" fill="#000" opacity="0.35" />
      {/* eyes */}
      <circle cx="9" cy="9" r="0.9" fill="#161a1a" />
      <circle cx="15" cy="9" r="0.9" fill="#161a1a" />
    </svg>
  );
}
