import { $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo,
  resetApp,
  stubNativeDialogs,
  switchScreen,
} from "../support/app";

const changeRow = (p: string) =>
  $(`[data-testid="changes-list"] [data-path="${p}"]`);

describe("stash", () => {
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

  it("stash save cleans the tree; pop restores it", async () => {
    // Stub window.prompt AFTER the last page load (openRepo already
    // happened in beforeEach) and BEFORE clicking Stash, which reads it.
    await stubNativeDialogs({ promptText: "e2e stash" });
    await $("button*=Stash").click();

    await $("div*=Working tree clean").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state after stash",
    });
    expect(repo.git("stash", "list")).toContain("e2e stash");

    // Pop from the Branches screen stash section.
    await switchScreen("branches");
    const stashRow = $("span*=stash@{0}");
    await stashRow.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "stash row never appeared in branches screen",
    });
    await stashRow.click();

    const popButton = $("button*=Pop");
    await popButton.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Pop button never appeared after selecting stash row",
    });
    await popButton.click();

    await switchScreen("commit");
    await changeRow("a.txt").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "changes list did not show a.txt after stash pop",
    });
    expect(repo.git("stash", "list").trim()).toBe("");
  });
});
