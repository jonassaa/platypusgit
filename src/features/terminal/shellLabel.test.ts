import { describe, expect, it } from "vitest";

import { shellLabel } from "./shellLabel";

describe("shellLabel", () => {
  it("is the basename of a path", () => {
    expect(shellLabel("/opt/homebrew/bin/fish")).toBe("fish");
    expect(shellLabel("/bin/zsh")).toBe("zsh");
  });

  it("handles a Windows path, which a settings export can carry anywhere", () => {
    expect(shellLabel("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      "pwsh.exe",
    );
  });

  it("says what blank MEANS rather than rendering nothing", () => {
    // An empty header reads as "something failed to load".
    expect(shellLabel("")).toBe("default shell");
    expect(shellLabel("   ")).toBe("default shell");
  });

  it("leaves a bare name alone", () => {
    expect(shellLabel("nu")).toBe("nu");
  });
});
