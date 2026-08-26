import type { Platform } from "@/lib/platform";
import type { UpdateCapability } from "@/lib/types";

/**
 * What to tell a user whose install can't swap its own binary.
 *
 * A `notify` or `notify-apt` capability means the backend decided this install
 * defers to a package manager (see `update::capability` in Rust); `notify-apt`
 * additionally means it knows the platypusgit apt repository is configured, so
 * it can name the command. Without a hint the panel showed a bare "View
 * release" button and nothing else, so a `.deb` user had no way to know *why*
 * the in-app install was unavailable or what to run instead — the panel was a
 * silent dead end.
 */
export interface PackageHint {
  /** One line on why in-app install is unavailable here. */
  note: string;
  /** Copy-pasteable upgrade command. */
  command: string;
}

/**
 * Hint for the notify path, or `null` when there's nothing useful to say.
 *
 * Returns `null` while `capability` is still loading (it's fetched once per
 * session) rather than guessing — a hint that flashes the wrong platform's
 * command is worse than no hint.
 *
 * Windows is never `notify` (`capability` returns `SelfUpdate` for it
 * unconditionally), so it has no arm; if that ever changes this yields `null`
 * rather than inventing a command.
 */
export function packageHint(
  capability: UpdateCapability | null,
  platform: Platform | undefined,
): PackageHint | null {
  // `notify-apt` is a notify path too — the backend already decided this install
  // defers to a package manager, it just knows WHICH one. Forgetting it here is
  // the one place a missed branch renders nothing at all.
  if (capability === "notify-apt") {
    return {
      // Character-for-character the command on the download page. Two places
      // telling one user two different upgrade commands is worse than either.
      note: "Updates come from apt on this install:",
      command: "sudo apt update && sudo apt upgrade platypus-git",
    };
  }
  if (capability !== "notify") return null;
  switch (platform) {
    case "macos":
      return {
        note: "In-app updates aren't available on macOS yet. If you installed with Homebrew:",
        command: "brew upgrade platypusgit",
      };
    case "linux":
      // A .deb (or hand-built) install that is NOT apt-managed: an AppImage sets
      // `APPIMAGE` and gets `self-update`, and an apt-managed .deb gets
      // `notify-apt` above, so what is left came from a manual `dpkg -i` or a
      // local build.
      //
      // The one-liner rather than another manual download, because it is the
      // single line that both upgrades now AND moves this install onto the path
      // where `apt upgrade` works from here on. The panel already offers "View
      // release" for anyone who would rather read the notes first.
      return {
        note: "This .deb didn't come from the platypusgit apt repository, so apt can't upgrade it. Switch over and updates come from your package manager:",
        command:
          "curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh",
      };
    default:
      return null;
  }
}
