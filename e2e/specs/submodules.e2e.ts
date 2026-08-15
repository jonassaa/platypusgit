import { browser, $, expect } from "@wdio/globals";
import { submoduleRepo, type SubmodulePair } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

/**
 * Submodules (#93) against a real superproject with a real submodule.
 *
 * The state mapping is what these assert: a submodule with no checkout has to read
 * as "not initialized" and offer Init, and Init has to actually write the url into
 * `.git/config` — the thing that turns a `.gitmodules` entry into something git can
 * update.
 */
describe("submodules", () => {
  let pair: SubmodulePair | null = null;

  afterEach(async () => {
    await resetApp();
    pair?.dispose();
    pair = null;
  });

  it("lists a checked-out submodule as up to date", async () => {
    pair = submoduleRepo();
    await openRepo(pair.repo.path);
    await switchScreen("submodules");

    const row = $(`[data-testid="submodule-row"][data-path="${pair.subPath}"]`);
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the submodule row never appeared",
    });
    expect(await row.getAttribute("data-state")).toBe("UpToDate");
    await row.$("span*=up to date").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the up-to-date pill never rendered",
    });
    // Repo truth: git agrees the submodule is at the recorded commit (a leading
    // space in `submodule status`, as opposed to `-` or `+`).
    expect(pair.repo.git("submodule", "status")).toMatch(/^ [0-9a-f]{40} /);
  });

  it("initializes a submodule that has no checkout", async () => {
    pair = submoduleRepo({ initialized: false });
    // Precondition, so a green run cannot be green for the wrong reason.
    expect(pair.repo.git("submodule", "status")).toMatch(/^-[0-9a-f]{40} /);

    await openRepo(pair.repo.path);
    await switchScreen("submodules");

    const row = $(`[data-testid="submodule-row"][data-path="${pair.subPath}"]`);
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the submodule row never appeared",
    });
    expect(await row.getAttribute("data-state")).toBe("Uninitialized");

    await row.$('[data-testid="submodule-init"]').click();
    await browser.waitUntil(
      async () =>
        pair!.repo.read(".git/config").includes(`submodule "${pair!.subPath}"`),
      {
        timeout: 20_000,
        timeoutMsg: ".git/config never gained the submodule section after Init",
      },
    );
  });
});
