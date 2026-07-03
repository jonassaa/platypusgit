import { browser, $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

describe("reflog", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  async function jumpViaDialog(): Promise<void> {
    await $("button*=Go to this point").click();
    const dialog = $('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 10_000, timeoutMsg: "action dialog missing" });
    // Each Option renders as its own <label> wrapping a native radio input
    // plus title/desc text — the label is the only element whose text is
    // scoped to just this option (any ancestor <div> also contains every
    // other option's text, so `div*=` would match the whole dialog body).
    await dialog.$("label*=Check out (detached)").click();
    await dialog.$("button*=Go").click();
  }

  it("checks out a reflog entry detached", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await switchScreen("reflog");
    const entry = $('[data-testid="commit-row"]*=feat: add b.txt');
    await entry.waitForDisplayed({ timeout: 15_000, timeoutMsg: "reflog entries missing" });
    await entry.click();
    await jumpViaDialog();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="branch-chip"]').getText()).includes("detached"),
      { timeout: 20_000, timeoutMsg: "chip never showed detached" },
    );
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");
  });

  it("dirty tree jump offers stash and proceeds", async () => {
    repo = basicRepo();
    repo.write("a.txt", "dirty before jump\n"); // dirty BEFORE open so store sees it
    await openRepo(repo.path);
    await switchScreen("reflog");
    const entry = $('[data-testid="commit-row"]*=feat: add b.txt');
    await entry.waitForDisplayed({ timeout: 15_000, timeoutMsg: "reflog entries missing" });
    await entry.click();
    await jumpViaDialog();
    // dirty-tree dialog intercepts the jump
    const stashBtn = $("button*=Stash them");
    await stashBtn.waitForDisplayed({ timeout: 10_000, timeoutMsg: "DirtyTreeDialog missing" });
    await stashBtn.click();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="branch-chip"]').getText()).includes("detached"),
      { timeout: 20_000, timeoutMsg: "jump after stash never completed" },
    );
    expect(repo.git("stash", "list").trim()).not.toBe("");
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");
  });
});
