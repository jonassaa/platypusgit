// The two halves of "yes, really, show me" (#396).
//
// #385 gave the blob ceiling one policy and an honest sentence: over the limit
// the delta comes back `oversized` and every diff surface prints "File too large
// to diff — 40 MB — over the 5.0 MB limit, so it was not read." What it named
// but could not act on was the user's own answer to that. The ceiling is a guess
// about intent — "a 5 MB text file is a generated artifact, not something anyone
// diffs in a GUI" — and it is usually right; when it is wrong it is completely
// wrong, and leaving the app was the only way past it.
//
// ONE component for all four diff surfaces, for the reason `oversizedDiffNotice`
// and `LfsDiffNotice` next door already give: a surface that grows its own
// button is how the same file comes to behave differently depending on which
// pane you opened it in. The sentence is shared; so is the button.
//
// Deliberately NOT a setting. A persisted "always diff huge files" turns a
// considered refusal into a footgun the user forgot they armed — this is per
// file and per view, and the surfaces drop it on navigation.

import { PGButton, PGEmpty, PGIcon } from "@/design";
import { oversizedDiffNotice, truncatedDiffNotice } from "@/lib/derive";
import type { FileDiff } from "@/lib/types";

/**
 * The action that goes under the "too large to diff" sentence.
 *
 * Renders nothing unless there is something to act on, so a surface can pass it
 * unconditionally: a real PNG keeps the plain "Binary file" empty state with no
 * button, because reading it anyway would still not produce a text diff.
 *
 * `pending` is the surface's own diff-loading flag. Re-reading a 40 MB blob is
 * seconds of work, and the label has to say so — the alternative is a click that
 * looks ignored.
 */
export function OversizedDiffAction({
  diff,
  pending = false,
  alreadyTried = false,
  onDiffAnyway,
}: {
  diff: FileDiff | null | undefined;
  pending?: boolean;
  /**
   * The user already waived the ceiling for this path and it came back over the
   * raised one too. Offering the same button again would promise something the
   * answer will not change — see `diffAnywayExhausted`.
   */
  alreadyTried?: boolean;
  /**
   * Absent for a surface that has nowhere to send the re-read — see
   * `CommitDiffPanel`'s `onDiffAnyway` prop. The sentence still renders; a
   * button that cannot work is worse than none, because the user cannot tell it
   * apart from a broken one.
   */
  onDiffAnyway?: () => void;
}) {
  // Nothing to act on: a real PNG read at any ceiling still has no text diff,
  // so the plain "Binary file" empty state is the complete answer there.
  if (!diff?.oversized || !onDiffAnyway) return null;
  if (alreadyTried) {
    return (
      <div
        data-testid="diff-anyway-exhausted"
        style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
      >
        This is over the largest size the app will diff.
      </div>
    );
  }
  return (
    <PGButton
      data-testid="diff-anyway"
      size="sm"
      icon="eye"
      disabled={pending}
      onClick={onDiffAnyway}
    >
      {pending ? "Reading…" : "Diff it anyway"}
    </PGButton>
  );
}

/**
 * The whole pane for a blob the ceiling refused — sentence and action together.
 *
 * **This has to take precedence over the image preview, and did not (#385).**
 * The three `ImageDiffOrEmpty` surfaces put the notice in that shell's
 * `fallback`, which `ImageDiffView` renders only when no side is "notable" —
 * and `MAX_PREVIEW_BYTES` (4 MiB) is BELOW the diff ceiling (5 MB), so every
 * blob over the diff ceiling is also over the preview one and comes back
 * `tooLarge`, which IS notable. The result: the honest "File too large to diff"
 * sentence was unreachable for every file it was written for, replaced by
 * "Too large to preview" — which says less and offers nothing to do.
 *
 * Invisible to the component tests, because `read_image_preview` is mocked to
 * `null` there and a null preview is not notable. `ImageDiffView.test.tsx`
 * pins the interaction now.
 *
 * An over-ceiling blob is not an image-preview situation at all: we declined to
 * read it, the size is the whole story, and there is exactly one thing to do
 * about it. A file that turns out to be a real image after the waived read
 * still reaches the preview — `oversized` is null by then.
 */
export function OversizedDiffEmpty({
  diff,
  pending = false,
  alreadyTried = false,
  onDiffAnyway,
  icon = "file",
}: {
  diff: FileDiff | null | undefined;
  pending?: boolean;
  alreadyTried?: boolean;
  /** Absent where the surface cannot answer it — the sentence still renders. */
  onDiffAnyway?: () => void;
  icon?: string;
}) {
  const notice = oversizedDiffNotice(diff);
  if (!notice) return null;
  return (
    <PGEmpty
      icon={icon}
      title={notice.title}
      action={
        <OversizedDiffAction
          diff={diff}
          pending={pending}
          alreadyTried={alreadyTried}
          onDiffAnyway={onDiffAnyway}
        />
      }
    >
      {notice.detail}
    </PGEmpty>
  );
}

/**
 * "Showing the first 100,000 of 812,345 lines" — the other end of the override.
 *
 * Raising the ceiling gets the blob read; it does not make a million rows
 * something a diff pane can lay out, so the backend caps the lines. A cap
 * nobody mentions is indistinguishable from a diff that just ends, which is the
 * silent wrong answer this area exists to avoid — so the pane says it, above the
 * rows, in the same place `LfsDiffNotice` says its piece.
 */
export function TruncatedDiffNotice({ diff }: { diff: FileDiff | null | undefined }) {
  const cut = truncatedDiffNotice(diff);
  if (!cut) return null;
  return (
    <div
      data-testid="truncated-diff-notice"
      style={{
        margin: "8px 12px",
        padding: "8px 10px",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-1)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: "var(--fs-11)",
        color: "var(--fg-2)",
      }}
    >
      <PGIcon name="warn" size={13} style={{ color: "var(--git-modified)", flexShrink: 0 }} />
      <span>
        <strong style={{ color: "var(--fg-0)", fontWeight: 600 }}>{cut.title}</strong>
        {" — "}
        {cut.detail}
      </span>
    </div>
  );
}
