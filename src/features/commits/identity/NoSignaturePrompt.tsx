// "git does not know who you are" (#212), as a thing you can fix in place.
//
// Shaped after `PGHookOutput`, for the same reasons and one more:
//
//   - Inline, not a modal: a modal over the commit panel would cover the
//     staged files and the message the user is one click from committing.
//   - Not the error banner: a banner is something you acknowledge, and this is
//     something you answer. Before #212 it WAS the banner, and it read
//     "NoSignature".
//   - Persistent until answered or dismissed, because the very next thing the
//     user does is type into it.
//
// It sits beside the hook block rather than replacing it: they are different
// refusals with different remedies, and a repository can produce both.

import { PGButton, PGIcon } from "@/design";
import { NO_SIGNATURE_HELP, NO_SIGNATURE_MESSAGE } from "@/lib/errors";

import { IdentityForm } from "./IdentityForm";

export function NoSignaturePrompt({
  repoId,
  onSaved,
  onDismiss,
}: {
  repoId: string;
  /**
   * The identity is set — retry the commit. Retrying rather than just closing
   * is the point: the user already typed a message and pressed Commit, and
   * making them press it again is a second failure with extra steps.
   */
  onSaved: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      // Child testids deliberately do NOT share this prefix — WebdriverIO
      // compiles `[data-testid="x"]*=text` to a substring attribute match, so a
      // child called `no-signature-body` would satisfy the container's own
      // condition and the container would match nothing. See the e2e-testing
      // skill.
      data-testid="no-signature"
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-4)",
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
        }}
      >
        <PGIcon name="user" />
        <span style={{ flex: 1, fontSize: "var(--fs-12)", fontWeight: 600 }}>
          {NO_SIGNATURE_MESSAGE}
        </span>
        <PGButton
          size="xs"
          variant="ghost"
          onClick={onDismiss}
          data-testid="identity-dismiss"
        >
          Dismiss
        </PGButton>
      </div>

      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--border-0)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            lineHeight: 1.5,
          }}
        >
          {NO_SIGNATURE_HELP}
        </div>
        <IdentityForm
          repoId={repoId}
          onSaved={onSaved}
          saveLabel="Save and commit"
          autoFocus
        />
      </div>
    </div>
  );
}
