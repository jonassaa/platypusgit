import { $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

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

  it("opens a repo via recents onto History, and Files still renders its tree", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    // Opening a repo lands on History — the log is the landing screen.
    await $('[data-testid="commit-row"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "History showed no commit rows after opening the repo",
    });
    // branch chip shows main
    await expect($('[data-testid="branch-chip"]')).toHaveText(
      expect.stringContaining("main"),
    );
    // …and the Files screen is one switch away, with its filter group.
    await switchScreen("repo");
    await expect($("button*=Changes")).toBeDisplayed();
  });

  // The shell is a fixed frame; panes scroll, the window never does. A wide row
  // or an off-viewport portal used to make the whole UI — titlebar, activity
  // bar, status bar — slide sideways.
  it("never lets the whole window scroll sideways", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    const box = await browser.execute(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);

    const scrolled = await browser.execute(() => {
      window.scrollTo(400, 0);
      return window.scrollX;
    });
    expect(scrolled).toBe(0);
  });
});
