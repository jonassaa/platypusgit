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
    // The row's columns are ONE CSS string (`commitRowGrid`), and the two
    // `minmax()`es in it are the whole of what keeps the subject column from
    // collapsing in a narrow pane. A webview that would not parse that value
    // drops the WHOLE property and lays every row out as a single auto track —
    // which reads as a styling nit and is actually the log losing its columns.
    // No jsdom test can see it and Chrome cannot answer it for WebKitGTK, so
    // the real webview is asked here: the property resolved, into five tracks.
    const columns = await browser.execute(
      () =>
        getComputedStyle(document.querySelector('[data-testid="commit-row"]')!)
          .gridTemplateColumns,
    );
    expect(columns).not.toBe("none");
    // Either form is a pass: engines report the USED track widths here, but a
    // specified `minmax(140px, 1fr)` carries a space of its own, so close it up
    // before counting rather than assuming which one came back.
    expect(columns.replace(/,\s+/g, ",").split(" ")).toHaveLength(5);

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
