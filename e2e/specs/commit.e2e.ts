import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

const changeRow = (p: string) =>
  $(`[data-testid="changes-list"] [data-path="${p}"]`);

describe("commit", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the changes list",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("commits staged changes; status clean after staging all", async () => {
    await $("button*=Stage all").click();
    await browser.waitUntil(
      async () => !(await $('[data-testid="changes-list"] [data-path]').isExisting()),
      {
        timeout: 20_000,
        timeoutMsg: "changes list should be empty after staging all",
      }
    );

    const subjectInput = $('[data-testid="commit-subject"]');
    await subjectInput.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "commit subject input never appeared",
    });
    await subjectInput.setValue("feat: e2e commit");

    const commitBtn = $('[data-testid="commit-button"]');
    await commitBtn.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "commit button never appeared",
    });
    await commitBtn.click();

    // UI as wait condition: CommitPanel returns to its empty state once the
    // commit lands (PGEmpty title "Working tree clean", rendered in a <div>).
    await $("div*=Working tree clean").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state",
    });

    // Repo truth as acceptance, asserted directly (not polled).
    expect(repo.git("log", "-1", "--pretty=%s").trim()).toContain(
      "feat: e2e commit"
    );
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
