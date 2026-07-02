import { browser, $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

describe("branches", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = basicRepo();
    await openRepo(repo.path);
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("creates a branch via picker, chip updates, checkout back works", async () => {
    const chip = $('[data-testid="branch-chip"]');

    // create + switch
    await chip.click();
    const search = $('input[placeholder="Switch to branch…"]');
    await search.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "branch search input never appeared",
    });
    await search.setValue("e2e-branch");
    const createSpan = $('[data-testid="branch-create"]');
    await createSpan.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "create-branch affordance never appeared",
    });
    await createSpan.click();
    await browser.waitUntil(
      async () => (await chip.getText()).includes("e2e-branch"),
      { timeout: 20_000, timeoutMsg: "chip did not update to new branch" },
    );
    expect(repo.git("branch", "--show-current").trim()).toBe("e2e-branch");

    // checkout main again via picker row
    // `data-branch-row` is a bare boolean attribute (no `${kind}:${name}`
    // value), so select the row by scoped text match instead of an exact
    // attribute-value selector.
    await chip.click();
    const mainRow = $('[data-branch-row]*=main');
    await mainRow.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "main branch row never appeared in picker",
    });
    await mainRow.click();
    await browser.waitUntil(
      async () => (await chip.getText()).includes("main"),
      { timeout: 20_000, timeoutMsg: "chip did not update back to main" },
    );
    expect(repo.git("branch", "--show-current").trim()).toBe("main");
  });
});
