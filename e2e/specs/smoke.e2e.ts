import { $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

describe("smoke", () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = undefined;
  });

  it("launches and shows the Welcome screen", async () => {
    // Debug builds take a few seconds to boot the webview + React app.
    // Bare `*=` maps to "partial link text" (anchors only), so scope to the
    // actual tag to get WDIO's XPath text matching.
    const heading = $("div*=Welcome to PlatypusGit");
    await heading.waitForDisplayed({ timeout: 30_000 });
    await expect(heading).toBeDisplayed();
    // PGButton wraps its label in a <span>, so exact-text `button=` never
    // matches; use partial text instead.
    await expect($("button*=Open repository…")).toBeDisplayed();
  });

  it("opens a repo via recents and shows the file tree", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    // RepoBrowser filter group proves the Files screen rendered
    await expect($("button*=Changes")).toBeDisplayed();
    // branch chip shows main
    await expect($('[data-testid="branch-chip"]')).toHaveText(
      expect.stringContaining("main"),
    );
  });
});
