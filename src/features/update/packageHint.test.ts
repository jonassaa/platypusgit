import { describe, expect, it } from "vitest";

import { packageHint } from "./packageHint";

describe("packageHint", () => {
  it("tells an apt-managed install to run apt upgrade", () => {
    const hint = packageHint("notify-apt", "linux");
    expect(hint?.command).toBe("sudo apt update && sudo apt upgrade platypusgit");
    expect(hint?.note).toMatch(/apt/i);
  });

  it("names the package apt actually reports", () => {
    // `platypusgit` is the real Package field. Tauri derives it from
    // `productName` with heck::AsKebabCase, so the lowercase productName maps
    // straight through with no hyphen inserted.
    //
    // The old `platypus-git` still resolves, via the .deb's Provides:, but a
    // virtual name installs without reporting — `apt policy` shows it as having
    // no candidate — so the hint must name the real one.
    expect(packageHint("notify-apt", "linux")?.command).toContain("platypusgit");
    expect(packageHint("notify-apt", "linux")?.command).not.toContain(
      "platypus-git",
    );
  });

  it("points a sideloaded .deb at the one-liner rather than another download", () => {
    // `apt upgrade` here would report "already the newest version" while the
    // panel says an update exists — the dead end this module exists to remove.
    // The one-liner both upgrades now and moves the install onto the apt path.
    const hint = packageHint("notify", "linux");
    expect(hint?.command).toBe(
      "curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh",
    );
    expect(hint?.note).toMatch(/apt repository/i);
  });

  it("keeps the Homebrew command for macOS", () => {
    expect(packageHint("notify", "macos")?.command).toBe(
      "brew upgrade platypusgit",
    );
    // macOS never gets the apt variant, but if the backend ever sent it the
    // command must not become a macOS user's problem.
    expect(packageHint("notify-apt", "macos")?.command).toBe(
      "sudo apt update && sudo apt upgrade platypusgit",
    );
  });

  it("says nothing when the install can update itself", () => {
    // An AppImage sets APPIMAGE, so the backend hands back `self-update` —
    // telling that user to run apt would be actively wrong.
    expect(packageHint("self-update", "linux")).toBeNull();
    expect(packageHint("self-update", "macos")).toBeNull();
  });

  it("says nothing before capability has loaded", () => {
    // `capability` is fetched once per session; a hint that flashes the wrong
    // platform's command is worse than no hint.
    expect(packageHint(null, "linux")).toBeNull();
  });

  it("invents no command for a platform it has no advice for", () => {
    expect(packageHint("notify", undefined)).toBeNull();
    // Windows is unconditionally `self-update` today; if that ever changes we
    // fall back to silence rather than guessing an installer command.
    expect(packageHint("notify", "windows")).toBeNull();
  });
});
