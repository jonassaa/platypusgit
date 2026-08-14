// Multi-repo tabs (#90). Two repositories open at once: the strip lists both,
// switching swaps the whole repo view, the chords cycle and close, and the open
// set survives a reload.
//
// Acceptance is repo truth wherever it exists — each fixture's commit summaries
// and branch names differ, so "the app is showing repo B" is provable from the
// screen rather than from the tab's own highlight.
import {
  activeRepoTabPath,
  armDriverBridge,
  jsChord,
  jsKey,
  openPalette,
  paletteDialog,
  paletteInput,
  repoTab,
  repoTabClose,
  repoTabCount,
  resetApp,
  seedOpenRepos,
  waitRepoLoaded,
} from "../support/app";
import { basicRepo, branchyRepo, TempRepo } from "../support/tempRepo";

/** The status bar's right slot renders the open repository's workdir — the one
 *  place the CURRENT repo's identity is on screen verbatim. */
function statusBarShows(repo: TempRepo) {
  const name = repo.path.split("/").filter(Boolean).pop() as string;
  // CHAINED, not one string: `span*=text` is wdio's partial-text form, not CSS,
  // so a compound like `[data-testid="status-bar"] span*=x` is handed to
  // querySelector verbatim and throws `SyntaxError: … is not a valid selector`.
  // Scoping has to happen as a parent lookup + a child text query.
  return $('[data-testid="status-bar"]').$(`span*=${name}`);
}

/** Every commit row's text, joined — the cheapest "which repository's history
 *  am I looking at" probe. */
function commitSummaries(): Promise<string> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="commit-row"]'))
      .map((r) => r.textContent ?? "")
      .join("\n"),
  );
}

async function waitShowing(repo: TempRepo, what: string): Promise<void> {
  await statusBarShows(repo).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: `status bar never named ${repo.path} (${what})`,
  });
}

describe("multi-repo tabs", () => {
  let alpha: TempRepo;
  let beta: TempRepo;

  before(() => {
    // Different shapes so a mix-up between them is visible: `basicRepo` is
    // linear on `main`, `branchyRepo` carries extra branches.
    alpha = basicRepo();
    beta = branchyRepo();
  });

  after(() => {
    alpha.dispose();
    beta.dispose();
  });

  it("restores the persisted open set as tabs, with only the active one loaded", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], alpha.path);

    await repoTab(alpha.path).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "no tab for the first repository after restore",
    });
    expect(await repoTabCount()).toBe(2);
    expect(await activeRepoTabPath()).toContain(
      alpha.path.split("/").filter(Boolean).pop() as string,
    );
    await waitShowing(alpha, "restored active tab");
  });

  it("clicking a tab switches the whole repository view", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], alpha.path);
    await waitShowing(alpha, "before the switch");
    await $('[data-testid="commit-row"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "no commit rows for the first repository",
    });
    expect(await commitSummaries()).not.toContain("merge feature");

    await repoTab(beta.path).click();

    await waitShowing(beta, "after clicking the second tab");
    // The switched-to repository's own history is what is listed now.
    await $('[data-testid="commit-row"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "no commit rows after switching tabs",
    });
    // beta is branchyRepo: it has a merge commit alpha (basicRepo) cannot have.
    const summaries = await commitSummaries();
    expect(summaries).toContain("merge feature");
    // Repo truth: that commit really is beta's and really is not alpha's.
    expect(beta.git("log", "--oneline")).toContain("merge feature");
    expect(alpha.git("log", "--oneline")).not.toContain("merge feature");
  });

  it("cycles tabs with the next/prev chords", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], alpha.path);
    await waitShowing(alpha, "before cycling");

    // Ctrl+Tab: on Linux/Windows the dispatcher normalizes physical Ctrl to
    // Mod, so this resolves to Mod+Tab there — both are bound for exactly that
    // reason (see presets.ts).
    await jsChord("Ctrl+Tab");
    await waitShowing(beta, "after Ctrl+Tab");

    await jsChord("Ctrl+Shift+Tab");
    await waitShowing(alpha, "after Ctrl+Shift+Tab");

    // Alt+2 jumps straight to the second tab.
    await jsChord("Alt+2");
    await waitShowing(beta, "after Alt+2");
  });

  it("closes a tab and leaves the other one active", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], beta.path);
    await waitShowing(beta, "before closing");

    await repoTabClose(beta.path).click();

    await waitShowing(alpha, "after closing the active tab");
    await browser.waitUntil(async () => (await repoTabCount()) === 1, {
      timeout: 20_000,
      timeoutMsg: "the closed tab is still in the strip",
    });
  });

  it("closing the last tab returns to Welcome", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path], alpha.path);
    await waitShowing(alpha, "before closing the only tab");

    await repoTabClose(alpha.path).click();

    await $("div*=Welcome to PlatypusGit").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "closing the last tab did not return to Welcome",
    });
    expect(await repoTabCount()).toBe(0);
  });

  it("the palette lists the open repositories and switches to one", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], alpha.path);
    await waitShowing(alpha, "before the palette switch");

    await openPalette();
    await $(paletteInput).setValue("Switch repository");
    await jsKey(paletteInput, "Enter");

    const betaName = beta.path.split("/").filter(Boolean).pop() as string;
    const row = $(paletteDialog).$(`[data-pal-index]*=${betaName}`);
    await row.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the repository switcher did not list the second repository",
    });
    await row.click();

    await waitShowing(beta, "after picking it in the palette");
  });

  it("keeps the open set across a reload", async () => {
    await resetApp();
    await seedOpenRepos([alpha.path, beta.path], alpha.path);
    await repoTab(beta.path).click();
    await waitShowing(beta, "before the reload");

    // No localStorage.clear(): the point is that pg-open-repos survives.
    await browser.refresh();
    await armDriverBridge();
    await waitRepoLoaded();
    await armDriverBridge();

    await browser.waitUntil(async () => (await repoTabCount()) === 2, {
      timeout: 20_000,
      timeoutMsg: "the open set did not come back after the reload",
    });
    // …and it comes back on the tab that was active, not the first one.
    await waitShowing(beta, "after the reload");
  });
});
