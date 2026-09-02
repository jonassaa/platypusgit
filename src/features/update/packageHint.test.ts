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

  it("tells a Scoop install to run scoop update", () => {
    const hint = packageHint("notify-scoop", "windows");
    expect(hint?.command).toBe("scoop update platypusgit");
    expect(hint?.note).toMatch(/scoop/i);
  });

  it("lets the backend's Scoop answer beat the platform arm", () => {
    // A Scoop install IS a Windows install, and Windows has no `notify` arm at
    // all — so if this were matched by platform first, the one install that most
    // needs a command would render nothing. Pinned because the ordering inside
    // packageHint is the whole mechanism.
    expect(packageHint("notify-scoop", "windows")?.command).toBe(
      "scoop update platypusgit",
    );
    // And it survives a platform the backend would never pair it with, rather
    // than falling through to that platform's advice.
    expect(packageHint("notify-scoop", undefined)?.command).toBe(
      "scoop update platypusgit",
    );
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
    // The .msi install, which is the Windows case that DOES self-update. It must
    // not be told to run `scoop update` for a package Scoop does not have.
    expect(packageHint("self-update", "windows")).toBeNull();
  });

  it("says nothing before capability has loaded", () => {
    // `capability` is fetched once per session; a hint that flashes the wrong
    // platform's command is worse than no hint.
    expect(packageHint(null, "linux")).toBeNull();
  });

  it("names the Store for a packaged install", () => {
    const hint = packageHint("store-managed", "windows");
    expect(hint).not.toBeNull();
    expect(hint?.note).toContain("Microsoft Store");
  });

  it("gives the Store hint no shell command to run", () => {
    // Every other notify variant hands over a command. This one must not: an
    // MSIX is read-only, there is nothing to type, and `winget upgrade` would be
    // advice for a channel this install did not come from.
    expect(packageHint("store-managed", "windows")?.command).toBe("");
  });

  it("trusts the backend's Store answer over the platform", () => {
    // Same rule the Scoop arm is pinned by: the capability is the more specific
    // answer and the platform switch must not get a chance to contradict it.
    expect(packageHint("store-managed", undefined)?.note).toContain(
      "Microsoft Store",
    );
  });

  it("invents no command for a platform it has no advice for", () => {
    expect(packageHint("notify", undefined)).toBeNull();
    // BARE `notify` on Windows, which the backend does not produce: Windows is
    // `self-update`, or `notify-scoop` when Scoop owns the install. So this
    // combination means "a package manager we could not name", and silence beats
    // guessing between an .msi, Scoop and a hand-unpacked copy.
    expect(packageHint("notify", "windows")).toBeNull();
  });
});
