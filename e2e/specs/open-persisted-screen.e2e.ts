// Launch lands on History (no screen restore), so opening a repo renders
// History once with empty state and again when the log arrives; a hook that
// only runs on the second render aborts the whole React root and the window
// goes blank.
//
// The rest of the suite switches screens after the repo is loaded, so the log
// is already there by the time History first renders — which is exactly why
// this went unnoticed.
import { branchyRepo, TempRepo } from "../support/tempRepo";
import { refreshAndSettle, resetApp, waitRepoLoaded } from "../support/app";

describe("opening a repo onto the History landing screen", () => {
  let repo: TempRepo;

  before(() => {
    repo = branchyRepo();
  });

  after(() => {
    repo.dispose();
  });

  it("keeps the shell mounted when History is the landing screen", async () => {
    await resetApp();

    await browser.execute((p: string) => {
      localStorage.setItem(
        "pg-recent-repos",
        JSON.stringify([{ path: p, openedAt: 1 }]),
      );
    }, repo.path);

    const rowSel = `[data-testid="recent-repo"][data-path="${repo.path}"]`;
    await refreshAndSettle(() =>
      $(rowSel).waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: "recent-repo row never appeared",
      }),
    );
    await $(rowSel).click();

    // The shell surviving IS the assertion: a hook-order violation unmounts
    // the React root, so the branch chip never appears and #root goes empty.
    await waitRepoLoaded();

    await $('[data-testid="commit-row"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "History rendered no commit rows after opening the repo",
    });

    const rootChildren = await browser.execute(
      () => document.getElementById("root")?.childElementCount ?? 0,
    );
    expect(rootChildren).toBeGreaterThan(0);
  });
});
