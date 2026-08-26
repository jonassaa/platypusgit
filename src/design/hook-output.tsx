// PGHookOutput (#232) — a git hook's refusal, rendered as output.
//
// Why inline and persistent rather than a modal or a toast:
//
//   - A modal blocks the very panel it is asking the user to fix. The next
//     action after "commitlint says your subject is too long" is editing the
//     subject, which is behind the modal.
//   - The existing `pgFlash` toast auto-dismisses, so a forty-line eslint dump
//     would be gone before a slow reader finished it — and it has nowhere to put
//     forty lines anyway.
//
// So the block sits under the message box and stays until dismissed or until
// the next commit attempt, which is exactly as long as it is useful.

import * as React from "react";

import type { HookRejection } from "@/lib/errors";
import { PGIcon } from "./icons";
import { PGButton } from "./primitives";

export function PGHookOutput({
  rejection,
  onDismiss,
  onCommitAnyway,
}: {
  rejection: HookRejection;
  onDismiss: () => void;
  /**
   * Retry with hooks off — the in-the-moment half of the escape hatch. Does not
   * tick the panel's checkbox: this is one commit, not a new default.
   */
  onCommitAnyway: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div
      // The child testids deliberately do NOT start with "hook-output":
      // WebdriverIO compiles `[data-testid="hook-output"]*=text` to a SUBSTRING
      // attribute match plus an innermost-only filter, so a child called
      // `hook-output-body` would satisfy the container's own condition and the
      // container would silently match nothing. See .claude/skills/e2e-testing.
      data-testid="hook-output"
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
        <PGIcon name="warn" />
        <span style={{ flex: 1, fontSize: "var(--fs-12)", fontWeight: 600 }}>
          The {rejection.hook} hook rejected this commit
        </span>
        <PGButton
          size="xs"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="hook-toggle"
        >
          {collapsed ? "Show" : "Hide"}
        </PGButton>
        <PGButton
          size="xs"
          variant="ghost"
          onClick={onDismiss}
          data-testid="hook-dismiss"
        >
          Dismiss
        </PGButton>
      </div>

      {!collapsed && (
        <pre
          data-testid="hook-body"
          style={{
            margin: 0,
            padding: "6px 8px",
            maxHeight: 200,
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            // A hook prints preformatted text, but a minified path or a long
            // rule name must not force the whole panel to scroll sideways.
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            borderTop: "1px solid var(--border-0)",
            color: "var(--fg-2)",
          }}
        >
          {/* A hook can refuse in total silence — exit 1, print nothing. Saying
              so beats an empty box that looks like a rendering bug. */}
          {rejection.output || "(the hook printed nothing)"}
        </pre>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "6px 8px",
          borderTop: "1px solid var(--border-0)",
        }}
      >
        <PGButton size="xs" onClick={onCommitAnyway} data-testid="hook-skip">
          Commit without hooks
        </PGButton>
      </div>
    </div>
  );
}
