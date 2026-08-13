import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { changeRow, openRepo, resetApp, switchScreen } from "../support/app";

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

    const messageBox = $('[data-testid="commit-message"]');
    await messageBox.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "commit message box never appeared",
    });
    await messageBox.setValue("feat: e2e commit");

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

  it("amends the last commit's message from a clean tree", async () => {
    await $("button*=Stage all").click();
    await browser.waitUntil(
      async () => !(await $('[data-testid="changes-list"] [data-path]').isExisting()),
      { timeout: 20_000, timeoutMsg: "changes list should be empty after staging all" },
    );
    await $('[data-testid="commit-message"]').setValue("feat: typo in mesage");
    await $('[data-testid="commit-button"]').click();
    await $("div*=Working tree clean").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state",
    });
    const commitsBefore = repo.git("rev-list", "--count", "HEAD").trim();

    // The clean-tree state is where a just-typed message gets fixed, so amend
    // is reachable from it — and it arrives prefilled with HEAD's message.
    await $('[data-testid="amend-last-commit"]').click();
    const messageBox = $('[data-testid="commit-message"]');
    await browser.waitUntil(
      async () => (await messageBox.getValue()) === "feat: typo in mesage",
      { timeout: 20_000, timeoutMsg: "amend never prefilled the previous message" },
    );
    await messageBox.setValue("feat: typo in message");
    await $('[data-testid="commit-button"]').click();

    await $("div*=Working tree clean").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state after amending",
    });
    expect(repo.git("log", "-1", "--pretty=%s").trim()).toBe(
      "feat: typo in message",
    );
    // Amend rewrites, never adds — history length is the proof.
    expect(repo.git("rev-list", "--count", "HEAD").trim()).toBe(commitsBefore);
  });
});
