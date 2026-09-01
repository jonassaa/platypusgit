import { PGIcon, PGIconButton, PGResizeHandle } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { DEFAULT_HEIGHT, useTerminalStore } from "./useTerminalStore";
import { TerminalView } from "./TerminalView";
import { shellLabel } from "./shellLabel";

/**
 * The docked terminal, below the active screen (#243).
 *
 * # Why this hides with CSS instead of unmounting
 *
 * Unmounting disposes the xterm instance, and with it the SCROLLBACK. The shell
 * itself survives — the backend session is not tied to the view — but the user
 * would reopen the panel to a blank pane attached to a live shell, with the
 * build output they were reading gone. That makes "hiding the panel leaves the
 * shell running" a promise that is technically kept and practically broken.
 *
 * So every repository with a live session keeps its view mounted, and only the
 * active one is visible. A tab switch then returns to the scrollback it left,
 * which is what every other terminal does.
 *
 * Nothing is mounted before the panel is first opened, so the "closed by
 * default, no shell nobody asked for" rule survives: a view only exists for a
 * repository that has been the active one while the panel was open.
 */
export function TerminalPanel() {
  const open = useTerminalStore((s) => s.open);
  const heightPx = useTerminalStore((s) => s.heightPx);
  const setHeight = useTerminalStore((s) => s.setHeight);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const epochs = useTerminalStore((s) => s.epochs);
  const repo = useRepoStore((s) => s.current);
  const shell = useSettingsStore((s) => s.terminalShell);

  // Every repository whose shell is alive, plus the active one when the panel
  // is open — that last part is what CREATES the first session.
  const live = Object.keys(epochs);
  const mounted =
    open && repo && !live.includes(repo.id) ? [...live, repo.id] : live;

  // Nothing to show and nothing to keep alive.
  if (mounted.length === 0) return null;

  return (
    <div
      data-testid="terminal-panel"
      // `hidden` rather than unmounting — see the note above. The attribute as
      // well as the style so a test can read the intent.
      hidden={!open}
      style={{
        display: open ? "flex" : "none",
        height: heightPx,
        flexShrink: 0,
        flexDirection: "column",
        borderTop: "1px solid var(--border-1)",
        background: "var(--bg-0)",
      }}
    >
      <PGResizeHandle
        orientation="vertical"
        side="top"
        testId="terminal-resize"
        // The handle is on TOP of the panel, so dragging up (negative dy) has
        // to make it taller. Hence the subtraction.
        onDrag={(dy) => setHeight(heightPx - dy)}
        onReset={() => setHeight(DEFAULT_HEIGHT)}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          fontSize: "var(--fs-11)",
          color: "var(--fg-3)",
          flexShrink: 0,
        }}
      >
        <PGIcon name="terminal" />
        {/* Naming the shell is what makes a slow `.zshrc` read as "zsh is
            starting" rather than as the app hanging. */}
        <span data-testid="terminal-shell-label">{shellLabel(shell)}</span>
        <span style={{ flex: 1 }} />
        <PGIconButton
          icon="x"
          size="sm"
          title="Hide terminal"
          onClick={() => setOpen(false)}
        />
      </div>
      {mounted.map((id) => (
        <TerminalView key={id} repoId={id} hidden={id !== repo?.id} />
      ))}
    </div>
  );
}
