import type { Platform } from "@/lib/platform";
import type { UpdateCapability } from "@/lib/types";

/**
 * What to tell a user whose install can't swap its own binary.
 *
 * `capability === "notify"` means the backend decided this install defers to a
 * package manager (see `update::capability` in Rust). Without a hint the panel
 * showed a bare "View release" button and nothing else, so a `.deb` user had no
 * way to know *why* the in-app install was unavailable or what to run instead —
 * the panel was a silent dead end.
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
  if (capability !== "notify") return null;
  switch (platform) {
    case "macos":
      return {
        note: "In-app updates aren't available on macOS yet. If you installed with Homebrew:",
        command: "brew upgrade platypusgit",
      };
    case "linux":
      // Reached by .deb (and any hand-built) installs: an AppImage sets
      // `APPIMAGE`, so it gets `self-update` and never lands here. We only
      // publish .deb + AppImage for Linux, so apt is the right advice.
      return {
        note: "In-app updates aren't available for package-manager installs. Download the .deb from the release page, then:",
        command: "sudo apt install ./PlatypusGit_amd64.deb",
      };
    default:
      return null;
  }
}
