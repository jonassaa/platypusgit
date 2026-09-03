// PGErrorBanner (#212) — the red strip an `AppError` is reported on.
//
// One component because there were two copies of this markup (AppShell's and
// Reflog's) and they had drifted in the two ways that mattered:
//
//   - Both led with `{error.kind}`, so the user read the Rust enum's own
//     spelling ("NoSignature:", "Network:", "Git:") in front of the sentence
//     `appErrorMessage` exists to produce. The label is now written prose or
//     nothing at all — see `errorBannerLabel`.
//   - Neither preserved newlines, so git's multi-line advice (a rejected push
//     is `! [rejected] …` plus a four-line `hint:` paragraph, all of which the
//     backend keeps — `progress::DEFAULT_TAIL_LINES`) arrived as one run-on
//     line with the fix buried in the middle of it. The clone dialog's error
//     slot had `pre-wrap` from the start; this is the same treatment.
//
// Not every `AppError` surface is this: a panel that shows a failure inline
// (Submodules, Worktrees, LFS) renders `appErrorMessage` in its own layout and
// is fine as it is. This is for the dismissible strip.

import {
  errorBannerLabel,
  errorBannerText,
  type AppError,
} from "@/lib/errors";

export function PGErrorBanner({
  error,
  onDismiss,
  compact = false,
}: {
  error: AppError;
  onDismiss: () => void;
  /** Tighter padding for a banner inside a screen rather than under the tab
   *  bar. The only thing the two call sites ever disagreed about. */
  compact?: boolean;
}) {
  const label = errorBannerLabel(error);
  return (
    <div
      role="alert"
      data-testid="error-banner"
      style={{
        padding: compact ? "6px 12px" : "8px 14px",
        fontSize: "var(--fs-12)",
        fontFamily: "var(--font-mono)",
        color: "var(--git-removed)",
        background: "oklch(0.68 0.18 25 / 0.1)",
        borderBottom: "1px solid oklch(0.68 0.18 25 / 0.35)",
        display: "flex",
        // `flex-start`, not `center`: a multi-line message would otherwise
        // float the dismiss button into the middle of the paragraph.
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      {label && (
        // The testids deliberately do not start with "error-banner": a
        // WebdriverIO `[data-testid="error-banner"]*=text` selector compiles to
        // a SUBSTRING attribute match plus an innermost-only filter, so a child
        // sharing the stem makes the container match nothing, silently. Same
        // reason `hook-output`'s body is `hook-body`.
        <strong data-testid="banner-label">{label}:</strong>
      )}
      <span
        data-testid="banner-text"
        style={{
          flex: 1,
          whiteSpace: "pre-wrap",
          // git's `hint:` paragraphs are bounded (twenty lines) but a remote's
          // `remote:` banner is not, so the TEXT scrolls rather than the strip:
          // scrolling the strip would carry the dismiss button out of reach on
          // exactly the errors that most need dismissing.
          maxHeight: "30vh",
          overflowY: "auto",
        }}
      >
        {errorBannerText(error)}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontSize: "var(--fs-11)",
        }}
      >
        dismiss
      </button>
    </div>
  );
}
