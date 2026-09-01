import { listen } from "@tauri-apps/api/event";
import React from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { termOpen, termResize, termWrite } from "@/lib/tauri";
import type { TermData, TermExit } from "@/lib/types";
import { appErrorMessage } from "@/lib/errors";
import { useElementSize } from "@/lib/useElementSize";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useTerminalStore } from "./useTerminalStore";

/**
 * Approximate cell size for the mono font at 12px, used ONLY to turn a measured
 * pixel box into rows and cols.
 *
 * Deliberately a constant rather than a measurement of a rendered glyph: xterm
 * lays out on its own metrics anyway, so this only has to be close enough that
 * the pty and the renderer agree on the shape of the grid. Being one column out
 * costs a wrap in the wrong place; measuring a glyph costs a layout read on
 * every resize tick.
 */
const CELL_W = 8;
const CELL_H = 17;

/**
 * Build xterm's theme from the design tokens.
 *
 * Read at mount rather than hardcoded, so the terminal is the app's colour
 * scheme and the accent hue is never baked in — the same rule the rest of the
 * design system follows.
 */
function themeFromCss(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--bg-0", "#101013"),
    foreground: v("--fg-0", "#e6e6e6"),
    cursor: v("--accent", "#7aa2f7"),
    cursorAccent: v("--bg-0", "#101013"),
    selectionBackground: v("--selection", "#2d3f63"),
  };
}

/** base64 → bytes. xterm's `write` takes `Uint8Array` and does incremental
 *  UTF-8 across chunks, which is why the payload crosses IPC as bytes at all. */
function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * One xterm instance for one repository (#243).
 *
 * Keyed by `repoId` at the call site, so switching tabs MOUNTS A DIFFERENT
 * instance rather than re-pointing this one — a re-pointed terminal would show
 * the previous repository's scrollback under the new repository's prompt.
 *
 * Unmounting does not end the session. Hiding the panel or switching tabs must
 * leave the shell running; `useTabsStore.close` is what ends it.
 */
export function TerminalView({
  repoId,
  hidden = false,
}: {
  repoId: string;
  /**
   * Mounted but not shown — an inactive tab's terminal, or every terminal
   * while the panel is collapsed. Hidden rather than unmounted so the
   * scrollback survives; see `TerminalPanel`.
   */
  hidden?: boolean;
}) {
  const { ref, width, height } = useElementSize();
  const shell = useSettingsStore((s) => s.terminalShell);
  const noteEpoch = useTerminalStore((s) => s.noteEpoch);

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<Terminal | null>(null);
  // A ref, not state: the event handlers below close over it once and must see
  // the CURRENT epoch, and a re-render per session would remount the terminal.
  const epochRef = React.useRef<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The shell setting is read once per session, not subscribed to: changing it
  // mid-session must not tear down a running shell under the user. It takes
  // effect the next time a terminal opens, which is what "restart to apply"
  // means everywhere else too.
  const shellRef = React.useRef(shell);
  shellRef.current = shell;

  React.useEffect(() => {
    const term = new Terminal({
      fontFamily: "var(--font-mono), monospace",
      fontSize: 12,
      theme: themeFromCss(),
      // A terminal that cannot scroll back loses your build output the moment
      // it finishes.
      scrollback: 5000,
      allowProposedApi: false,
    });
    termRef.current = term;
    if (hostRef.current) term.open(hostRef.current);

    // Keystrokes are sent STRICTLY IN ORDER, one IPC call at a time.
    //
    // `onData` fires once per keystroke, and firing an un-awaited `term_write`
    // from each one lets the calls race: they are separate async invokes, they
    // complete in whatever order they complete, and the pty receives the bytes
    // in that order. Measured, not theorised — typing `echo ZZMARKER` into the
    // real app arrived at the shell as `ecoZARhR ZMKE`. A paste or a fast
    // typist would hit it every time.
    //
    // Chaining each write onto the previous one costs a promise per keystroke
    // and makes reordering unrepresentable.
    let writeChain: Promise<unknown> = Promise.resolve();
    const typed = term.onData((data) => {
      writeChain = writeChain.then(() =>
        termWrite(repoId, data).catch(() => {
          // The session is gone; the exit listener is what reports that. The
          // catch is also what keeps one failure from breaking the chain for
          // every keystroke after it.
        }),
      );
    });

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    /**
     * Output that arrived before we knew our epoch.
     *
     * The listeners are attached BEFORE `term_open`, because `term_open`
     * spawns the shell and its reader thread before it returns — so the
     * shell's very first bytes, which include the prompt, are emitted while a
     * listener attached afterwards does not exist yet. Tauri does not buffer
     * events, so those bytes are simply gone: the terminal opens blank and
     * stays blank until the user blindly types something. Attaching first
     * means events can arrive before the epoch is known, and this holds them
     * until it is.
     */
    let pending: TermData[] | null = [];

    const writeData = (p: TermData) => term.write(decode(p.data));

    void (async () => {
      try {
        unlisteners.push(
          await listen<TermData>("term://data", (e) => {
            // Another repository's traffic is never ours.
            if (e.payload.repoId !== repoId) return;
            if (pending) {
              pending.push(e.payload);
              return;
            }
            // A dead session's tail: a reader still mid-read when the terminal
            // was reopened would otherwise paint the old shell's last line
            // into the new one.
            if (e.payload.epoch !== epochRef.current) return;
            writeData(e.payload);
          }),
        );
        unlisteners.push(
          await listen<TermExit>("term://exit", (e) => {
            if (e.payload.repoId !== repoId) return;
            // Before the epoch is known there is exactly one session for this
            // repository, so an exit for it is ours.
            if (!pending && e.payload.epoch !== epochRef.current) return;
            const { code } = e.payload;
            term.write(
              `\r\n\x1b[2m[shell exited${code === null ? "" : ` with ${code}`}]\x1b[0m\r\n`,
            );
            // No auto-respawn: the user typed `exit` and meant it, and a shell
            // that comes back is a shell you cannot get rid of.
            epochRef.current = null;
          }),
        );

        const epoch = await termOpen(
          repoId,
          term.rows,
          term.cols,
          shellRef.current,
        );
        if (disposed) return;
        epochRef.current = epoch;
        noteEpoch(repoId, epoch);

        // Flush what arrived while we were opening, in order, and switch to
        // the live path. No `await` between the two, so no event can slip
        // past into a queue nobody drains.
        const queued = pending;
        pending = null;
        for (const p of queued) {
          if (p.epoch === epoch) writeData(p);
        }
      } catch (e) {
        pending = null;
        if (!disposed) setError(appErrorMessage(e));
      }
    })();

    return () => {
      disposed = true;
      typed.dispose();
      for (const un of unlisteners) un();
      term.dispose();
      termRef.current = null;
    };
    // `shell` is deliberately absent — see shellRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, noteEpoch]);

  // Fit on the MEASURED size, not on a ResizeObserver: WebKitGTK does not have
  // one, so xterm's FitAddon would leave the Linux build rendering 80x24 in a
  // 200-column pane forever. `useElementSize` reads first and observes second.
  // The renderer and the pty are resized together so they cannot disagree.
  React.useEffect(() => {
    const term = termRef.current;
    if (!term || width === 0 || height === 0) return;
    const cols = Math.max(20, Math.floor(width / CELL_W));
    const rows = Math.max(4, Math.floor(height / CELL_H));
    if (cols === term.cols && rows === term.rows) return;
    term.resize(cols, rows);
    void termResize(repoId, rows, cols).catch(() => {
      // No session yet, or it has exited. Neither is worth a banner.
    });
  }, [width, height, repoId]);

  return (
    <div
      ref={ref}
      data-testid="terminal-view"
      data-repo-id={repoId}
      // `display: none` and not the `hidden` attribute, because this element is
      // a flex child: `hidden` is overridden by the `display` a flex container
      // gives its children in some engines, and a "hidden" terminal that still
      // takes a row is worse than either state.
      style={{
        display: hidden ? "none" : undefined,
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: "4px 6px",
        background: "var(--bg-0)",
      }}
    >
      {error ? (
        <div
          data-testid="terminal-error"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--danger)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      ) : null}
      <div
        ref={hostRef}
        style={{ width: "100%", height: "100%", display: error ? "none" : undefined }}
      />
    </div>
  );
}
