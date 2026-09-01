/**
 * The name to show for a configured shell path (#243).
 *
 * The panel header names the shell so a slow start is attributed to the right
 * thing — a `.zshrc` that takes two seconds should read as "zsh is starting",
 * not as the app hanging. A full path there would be noise; the basename is
 * what the user calls it.
 */
export function shellLabel(shell: string): string {
  const trimmed = shell.trim();
  // Blank is the default and the common case. Saying so beats an empty header,
  // which would read as "something failed to load".
  if (!trimmed) return "default shell";
  // Split on both separators, not the platform's: a Windows path can reach a
  // macOS dev's settings export, and this is a label, not a filesystem call.
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
