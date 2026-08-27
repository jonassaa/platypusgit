import type { Platform } from "@/lib/platform";
import type { UpdateCapability } from "@/lib/types";

/**
 * What to tell a user whose install can't swap its own binary.
 *
 * Any capability other than `self-update` means the backend decided this install
 * defers to a package manager (see `update::capability` in Rust). The suffixed
 * ones additionally say WHICH: `notify-apt` that the platypusgit apt repository
 * is configured, `notify-scoop` that this exe lives in a Scoop install — so the
 * hint can name the exact command instead of guessing from the platform.
 * Without a hint the panel showed a bare "View release" button and nothing
 * else, so a `.deb` user had no way to know *why* the in-app install was
 * unavailable or what to run instead — the panel was a silent dead end.
 */
export interface PackageHint {
  /** One line on why in-app install is unavailable here. */
  note: string;
  /**
   * Copy-pasteable upgrade command, or `""` when there is genuinely nothing to
   * run — `notify-store`, where the Store upgrades the package itself.
   * `UpdatePanel` renders the command box only when this is non-empty.
   */
  command: string;
}

/**
 * Hint for the notify path, or `null` when there's nothing useful to say.
 *
 * Returns `null` while `capability` is still loading (it's fetched once per
 * session) rather than guessing — a hint that flashes the wrong platform's
 * command is worse than no hint.
 *
 * Windows reaches the notify path only as `notify-scoop`, handled below by
 * capability rather than by platform. Bare `notify` on Windows has no arm — that
 * combination means the backend deferred to a package manager it could not
 * name, and inventing an installer command for it would be a guess — so it
 * yields `null`.
 */
export function packageHint(
  capability: UpdateCapability | null,
  platform: Platform | undefined,
): PackageHint | null {
  // The suffixed variants are notify paths too — the backend already decided
  // this install defers to a package manager, it just knows WHICH one. They are
  // matched BEFORE the platform switch because the backend's answer is the more
  // specific one: a Scoop install is a Windows install, and the platform arm
  // must not get a chance to contradict it. Forgetting a variant here is the one
  // place a missed branch renders nothing at all.
  if (capability === "notify-apt") {
    return {
      // Character-for-character the command on the download page. Two places
      // telling one user two different upgrade commands is worse than either.
      note: "Updates come from apt on this install:",
      command: "sudo apt update && sudo apt upgrade platypusgit",
    };
  }
  if (capability === "notify-scoop") {
    return {
      // No URL in this one, deliberately: Scoop already has the bucket, so the
      // upgrade needs nothing fetched from us. It is also why this arm adds no
      // entry to test/privacy.test.ts's hostname allowlist.
      note: "Updates come from Scoop on this install:",
      command: "scoop update platypusgit",
    };
  }
  if (capability === "notify-store") {
    return {
      // The one hint with an EMPTY command, and the reason is in the Rust enum:
      // the Store updates this install by itself. Naming `winget upgrade` here
      // would send a Store user to a channel they are not on; naming a download
      // would send them to a file they cannot install over the package.
      //
      // UpdatePanel renders the command box only for a non-empty command, so
      // this arm shows its note alone. Returning `null` instead would be wrong:
      // that is "nothing useful to say", and there IS something to say.
      note: "This install came from the Microsoft Store, which keeps it up to date:",
      command: "",
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
