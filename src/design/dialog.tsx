// Styled confirm/prompt dialogs replacing window.confirm / window.prompt
// (#61 C3).
//
// Native dialogs are OS chrome dropped into a dense, themed, monospace app:
// wrong typeface, wrong colors, no danger styling, and on some platforms they
// steal focus from the whole window. They also cannot express what the
// destructive ones need — a typed-name confirmation, a body distinct from the
// title, a red primary button.
//
// The API is deliberately promise-shaped rather than component-shaped, because
// every replaced call site reads `if (window.confirm(msg))` inline inside a
// menu handler. `if (await pgConfirm(msg))` is the same line with one keyword
// added; a <Dialog open={…}> component would have meant lifting state into ten
// screens and rewriting each handler.
//
// One host renders the queue (mounted per window — main and merge both mount
// it). Requests queue rather than stack: two dialogs at once is never what the
// user meant, and a modal opening over a modal cannot be dismissed predictably.

import React, { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PGButton, PGInput } from "./primitives";
import { PGIcon } from "./icons";

export interface PGConfirmOptions {
  /** Headline. Keep it a question. */
  title: string;
  /** Optional detail under the title. */
  body?: ReactNode;
  /** Primary button label. Defaults to "Confirm" / "Delete" when danger. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red primary button + warning glyph. */
  danger?: boolean;
  /**
   * Hide the Cancel button — an acknowledgement rather than a question.
   *
   * Escape and the backdrop still dismiss, so there is always a way out; what
   * goes away is the second button, which on a "here is the output" dialog
   * offers a choice that does not exist. See `pgAlert`.
   */
  hideCancel?: boolean;
  /**
   * Require typing this exact string before the primary button enables —
   * for the genuinely unrecoverable operations (GitKraken-style).
   */
  requireText?: string;
}

export interface PGPromptOptions {
  title: string;
  body?: ReactNode;
  /** Prefilled value. */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Reject empty input (after trimming) — the primary button stays disabled. */
  requireValue?: boolean;
  mono?: boolean;
  /**
   * Rows for a textarea instead of a one-line input — for values that are
   * genuinely multi-line, like a combined commit message. Enter then inserts a
   * newline and ⌘/Ctrl+Enter submits.
   */
  multiline?: number;
}

/** One answer offered by `pgChoose`. */
export interface PGChooseOption {
  /** What `pgChoose` resolves to when this one is picked. */
  id: string;
  label: string;
  /** Filled primary button — the recommended answer. At most one. */
  primary?: boolean;
  /** Red button — the destructive answer, if there is one. */
  danger?: boolean;
}

export interface PGChooseOptions {
  /** Headline. Keep it a question. */
  title: string;
  /** Optional detail under the title. */
  body?: ReactNode;
  /**
   * The answers, left to right. Dismissal is never one of them — see
   * `pgChoose`.
   */
  choices: PGChooseOption[];
  cancelLabel?: string;
}

type Request =
  | { id: number; kind: "confirm"; opts: PGConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: "prompt"; opts: PGPromptOptions; resolve: (v: string | null) => void }
  | { id: number; kind: "choose"; opts: PGChooseOptions; resolve: (v: string | null) => void };

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function push(req: Request) {
  queue = [...queue, req];
  emit();
}

/** Settle the head of the queue and move on. */
function settle(id: number, value: boolean | string | null) {
  const req = queue.find((r) => r.id === id);
  queue = queue.filter((r) => r.id !== id);
  emit();
  if (!req) return;
  if (req.kind === "confirm") req.resolve(value === true);
  else req.resolve(typeof value === "string" ? value : null);
}

/**
 * Ask for confirmation. Resolves true only if the user confirms; Escape,
 * backdrop click and Cancel all resolve false — same contract as
 * `window.confirm`, so a call site only gains an `await`.
 *
 * Falls back to resolving false when no host is mounted, so a caller can never
 * hang waiting on a dialog nobody can see.
 */
export function pgConfirm(opts: PGConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === "string" ? { title: opts } : opts;
  if (listeners.size === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    push({ id: nextId++, kind: "confirm", opts: o, resolve });
  });
}

/**
 * Show something and wait for it to be acknowledged.
 *
 * `pgConfirm` with one button. It exists because the alternative at every call
 * site is `window.alert`, which this codebase bans for the same reasons it bans
 * `window.confirm`: unstyled, blocks the whole webview, and cannot show
 * anything but a short string.
 *
 * Resolves when dismissed, however it was dismissed — there is no answer to
 * report, so callers do not have one to handle.
 */
export async function pgAlert(opts: PGConfirmOptions | string): Promise<void> {
  const o = typeof opts === "string" ? { title: opts } : opts;
  await pgConfirm({ confirmLabel: "Close", ...o, hideCancel: true });
}

/**
 * Ask for a line of text. Resolves the string, or null if dismissed — same
 * contract as `window.prompt`, including "empty string" being a real answer
 * distinct from null (unless `requireValue`).
 */
export function pgPrompt(opts: PGPromptOptions | string): Promise<string | null> {
  const o = typeof opts === "string" ? { title: opts } : opts;
  if (listeners.size === 0) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    push({ id: nextId++, kind: "prompt", opts: o, resolve });
  });
}

/**
 * Ask the user to pick one of several named answers. Resolves the chosen
 * option's `id`.
 *
 * **Dismissal is never a choice.** Escape, the backdrop, Cancel and a missing
 * host all resolve `null`, so a call site can only act on an answer the user
 * actually gave — the same reason `pgConfirm` resolves false rather than
 * throwing. Reach for this instead of chaining two `pgConfirm`s when a refusal
 * has two genuinely different remedies; a second modal over the first cannot be
 * dismissed predictably (see the queue note at the top of this file).
 */
export function pgChoose(opts: PGChooseOptions): Promise<string | null> {
  if (listeners.size === 0) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    push({ id: nextId++, kind: "choose", opts, resolve });
  });
}

function useQueueHead(): Request | undefined {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return queue[0];
}

/**
 * Renders whichever dialog is at the head of the queue. Mount exactly once per
 * window, near the root.
 */
export function PGDialogHost() {
  const req = useQueueHead();
  if (!req) return null;
  return <DialogView key={req.id} req={req} />;
}

function DialogView({ req }: { req: Request }) {
  const isConfirm = req.kind === "confirm";
  // A choice is neither a question nor a field: it renders no input, and it has
  // no single "accept" for Enter to mean.
  const isPrompt = req.kind === "prompt";
  const isChoose = req.kind === "choose";
  const danger = isConfirm && !!(req.opts as PGConfirmOptions).danger;
  // An acknowledgement, not a question — see `pgAlert`.
  const hideCancel = isConfirm && !!(req.opts as PGConfirmOptions).hideCancel;
  const requireText = isConfirm
    ? (req.opts as PGConfirmOptions).requireText
    : undefined;

  const [value, setValue] = React.useState(
    isConfirm ? "" : ((req.opts as PGPromptOptions).initialValue ?? ""),
  );
  const inputRef = React.useRef<HTMLInputElement>(null);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    // Focus the input if there is one, else the primary button, so Enter and
    // Escape work without a click first.
    const t = setTimeout(() => {
      const field = areaRef.current ?? inputRef.current;
      field?.focus();
      field?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const promptOpts = req.opts as PGPromptOptions;
  const canSubmit = isConfirm
    ? requireText === undefined || value === requireText
    : !promptOpts.requireValue || value.trim().length > 0;

  const cancel = () => settle(req.id, isConfirm ? false : null);
  const accept = () => {
    if (!canSubmit) return;
    settle(req.id, isConfirm ? true : value);
  };

  // Escape/Enter are handled here rather than through the keymap: a modal owns
  // the keyboard while it is up, and routing through the global dispatcher
  // would let a pane-scoped binding answer first.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      // A choice dialog has no single answer to submit: Enter belongs to
      // whichever choice button has focus, and calling preventDefault here
      // would swallow the browser's own activation of it.
      if (isChoose) return;
      // In a multi-line prompt Enter belongs to the text; submitting is a chord.
      if (!isConfirm && promptOpts.multiline && !(e.metaKey || e.ctrlKey)) return;
      e.stopPropagation();
      e.preventDefault();
      accept();
    }
  };

  const confirmLabel =
    (isConfirm
      ? (req.opts as PGConfirmOptions).confirmLabel
      : promptOpts.confirmLabel) ?? (danger ? "Delete" : "Confirm");
  const cancelLabel =
    (isConfirm
      ? (req.opts as PGConfirmOptions).cancelLabel
      : promptOpts.cancelLabel) ?? "Cancel";

  return createPortal(
    <div
      data-pg-dialog=""
      // Lets a driver tell "are you sure?" from "type a value" without
      // inspecting the inputs — a requireText confirm has an input too.
      data-pg-dialog-kind={req.kind}
      role="dialog"
      aria-modal="true"
      aria-label={req.opts.title}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Backdrop click cancels; clicks inside the card must not.
        if (e.target === e.currentTarget) cancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999998,
        background: "oklch(0 0 0 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="pg-fade-in"
        style={{
          width: "min(440px, 100%)",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-5)",
          boxShadow: "var(--shadow-3)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {danger && (
            <PGIcon
              name="warn"
              size={16}
              style={{ color: "var(--git-removed)", marginTop: 2 }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div
              data-testid="dialog-title"
              style={{
                fontSize: "var(--fs-13)",
                fontWeight: "var(--fw-semibold)",
                color: "var(--fg-0)",
              }}
            >
              {req.opts.title}
            </div>
            {req.opts.body && (
              <div
                style={{
                  fontSize: "var(--fs-12)",
                  color: "var(--fg-2)",
                  lineHeight: "var(--lh-body)",
                  wordBreak: "break-word",
                }}
              >
                {req.opts.body}
              </div>
            )}
          </div>
        </div>

        {isPrompt &&
          (promptOpts.multiline ? (
            <textarea
              ref={areaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={promptOpts.placeholder}
              rows={promptOpts.multiline}
              data-testid="dialog-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-3)",
                color: "var(--fg-0)",
                fontFamily: promptOpts.mono === false ? "var(--font-sans)" : "var(--font-mono)",
                fontSize: "var(--fs-12)",
                lineHeight: "var(--lh-body)",
                padding: "6px 8px",
                resize: "vertical",
                outline: "none",
              }}
            />
          ) : (
            <PGInput
              inputRef={inputRef}
              value={value}
              onChange={setValue}
              placeholder={promptOpts.placeholder}
              mono={promptOpts.mono}
              data-testid="dialog-input"
            />
          ))}
        {isConfirm && requireText !== undefined && (
          <PGInput
            inputRef={inputRef}
            value={value}
            onChange={setValue}
            placeholder={requireText}
            mono
            data-testid="dialog-input"
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            // Three answers plus Cancel do not always fit 440px, and a choice
            // the user cannot see is a choice they cannot make.
            flexWrap: "wrap",
          }}
        >
          <>
            {!hideCancel && (
              <PGButton size="sm" variant="ghost" onClick={cancel} data-testid="dialog-cancel">
                {cancelLabel}
              </PGButton>
            )}
            {isChoose ? (
              (req.opts as PGChooseOptions).choices.map((c) => (
                <PGButton
                  key={c.id}
                  size="sm"
                  variant={c.danger ? "danger" : c.primary ? "primary" : "default"}
                  onClick={() => settle(req.id, c.id)}
                  data-testid={`dialog-choice-${c.id}`}
                >
                  {c.label}
                </PGButton>
              ))
            ) : (
              <PGButton
                size="sm"
                variant={danger ? "danger" : "primary"}
                disabled={!canSubmit}
                onClick={accept}
                data-testid="dialog-confirm"
              >
                {confirmLabel}
              </PGButton>
            )}
          </>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Test helper: drop any queued dialogs between cases. */
export function __resetDialogs() {
  queue = [];
  emit();
}
