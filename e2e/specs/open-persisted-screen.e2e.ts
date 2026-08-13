// Opening a repo lands on whatever screen was persisted from last session, not
// necessarily Files. That path renders the screen once with empty state and
// again when the data arrives; a hook that only runs on the second render
// aborts the whole React root and the window goes blank.
//
// The rest of the suite always opens a repo onto Files and switches screens
// afterwards, so the log is already loaded by the time History first renders —
// which is exactly why this went unnoticed.
import { branchyRepo, TempRepo } from "../support/tempRepo";
import { armDriverBridge, resetApp, waitRepoLoaded } from "../support/app";

describe("opening a repo onto a persisted screen", () => {
  let repo: TempRepo;

  before(() => {
    repo = branchyRepo();
  });

  after(() => {
    repo.dispose();
  });

  it("keeps the shell mounted when History is the restored screen", async () => {
    await resetApp();

    await browser.execute((p: string) => {
      localStorage.setItem(
        "pg-recent-repos",
        JSON.stringify([{ path: p, openedAt: 1 }]),
      );
      localStorage.setItem("pg-screen", "history");
    }, repo.path);

    await browser.refresh();
    await armDriverBridge();

    const row = $(`[data-testid="recent-repo"][data-path="${repo.path}"]`);
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "recent-repo row never appeared",
    });
    await armDriverBridge();
    await row.click();

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
