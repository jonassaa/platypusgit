import React from "react";
import { error as logError } from "@tauri-apps/plugin-log";

import { describeError } from "@/lib/errors";

/**
 * Last line of defence around a whole window.
 *
 * React unmounts the entire root when a render throws, so without a boundary
 * one broken screen leaves the user staring at an empty window with no message
 * and nothing to click. Catching here trades that for the error text and
 * a way out, which is also what makes such a bug reportable at all.
 *
 * Deliberately app-level and dumb: no retry-with-backoff, no per-screen
 * boundaries. A render throw is a bug, and the useful behaviours are "say what
 * broke" and "let me reload".
 */
interface Props {
  children: React.ReactNode;
  /** Overrides the reload action — the merge window closes instead. */
  onReload?: () => void;
  /**
   * Files a bug report for the throw (`features/report`). Optional, and a
   * CALLBACK rather than work done here, for two independent reasons:
   *
   *   - Nothing in `src/design/` performs IPC, and this is not the place to
   *     start: a design-system component that reaches for `@/lib/tauri` cannot
   *     be rendered in a test without a bridge.
   *   - This boundary cannot use the report DIALOG under any circumstances.
   *     `PGDialogHost` and `ReportIssueDialog` are both mounted by `AppShell`,
   *     which is mounted inside this boundary (`main.tsx`), so by the time
   *     this fallback renders React has unmounted them. Calling `openReport()`
   *     from here would set a flag nobody reads.
   *
   * `main.tsx` wires it to `features/report/fileReport.ts::fileBugReport`,
   * which gathers, copies and opens in one call with no React tree involved.
   */
  onReport?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

export class PGErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the component stack — a minified production stack alone rarely
    // names the screen that threw.
    console.error("Unhandled render error:", error, info.componentStack);
    // And to the LOG FILE, which is the only artifact a reporter can hand over:
    // #146 was diagnosed (and mis-diagnosed) entirely from one, and a Linux user
    // will never open a devtools console. `describeError` for the same reason
    // `invoke` uses it — the throw need not be an `Error`, and this is a log line
    // rather than a banner, so leading with the kind is right here.
    logError(
      `unhandled render error: ${describeError(error)}${
        info.componentStack ? ` | component stack: ${info.componentStack}` : ""
      }`,
    );
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="app-error-boundary"
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          background: "var(--bg-0)",
          color: "var(--fg-0)",
          fontSize: "var(--fs-12)",
          overflow: "auto",
        }}
      >
        <strong style={{ fontSize: "var(--fs-14)" }}>
          Something broke while drawing this screen
        </strong>
        <div style={{ color: "var(--fg-2)" }}>
          This is a bug in platypusgit, not in your repository — nothing was
          written to it.
        </div>
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--git-removed)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            margin: 0,
            maxWidth: "100%",
          }}
        >
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          {this.props.onReport && (
            <button
              data-testid="boundary-report"
              onClick={() => this.props.onReport?.(error)}
              style={{
                background: "var(--bg-2)",
                color: "var(--fg-0)",
                border: "1px solid var(--border-1)",
                borderRadius: 4,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: "var(--fs-12)",
              }}
            >
              Report this bug
            </button>
          )}
          <button
            onClick={() => {
              if (this.props.onReload) this.props.onReload();
              else window.location.reload();
            }}
            style={{
              background: "var(--accent)",
              color: "var(--bg-0)",
              border: "none",
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: "var(--fs-12)",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
