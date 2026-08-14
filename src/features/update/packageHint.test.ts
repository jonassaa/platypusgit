import { describe, expect, it } from "vitest";

import { packageHint } from "./packageHint";

describe("packageHint", () => {
  it("gives .deb users an apt command instead of a silent dead end", () => {
    const hint = packageHint("notify", "linux");
    expect(hint?.command).toBe("sudo apt install ./PlatypusGit_amd64.deb");
    expect(hint?.note).toMatch(/package-manager/i);
  });

  it("keeps the Homebrew command for macOS", () => {
    expect(packageHint("notify", "macos")?.command).toBe(
      "brew upgrade platypusgit",
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
