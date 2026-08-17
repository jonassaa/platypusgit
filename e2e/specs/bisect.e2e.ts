import { browser, $, expect } from "@wdio/globals";
import { bisectRepo, type TempRepo } from "../support/tempRepo";
import {
  openPalette,
  openRepo,
  paletteDialog,
  paletteInput,
  resetApp,
  scrollCommitListTo,
  stubNativeDialogs,
} from "../support/app";

/** Click the palette row whose visible label contains `text`. */
async function clickPaletteRow(text: string): Promise<void> {
  const row = $(paletteDialog).$(`[data-pal-index]*=${text}`);
  await row.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: `palette row "${text}" never appeared`,
  });
  await row.click();
}

/**
 * Bisect (#93), driven through the palette because bisect deliberately has no
 * keyboard chords (a misfired mark corrupts the search with no undo short of a
 * reset — see the design doc).
 *
 * The acceptance is GIT's own state: `.git/BISECT_LOG`, `git bisect log` and where
 * HEAD lands after a reset. There is no parallel state file to check, and that is
 * the point of the whole subsystem.
 */
describe("bisect", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    // Leave no bisect behind for the next spec's fixture-free assumptions.
    try {
      repo?.git("bisect", "reset");
    } catch {
      // Nothing in progress — fine.
    }
    await resetApp();
    repo?.dispose();
    repo = null;
  });

  it("starts from the palette, marks a revision, and resets home", async () => {
    repo = bisectRepo();
    const startBranch = repo.git("rev-parse", "--abbrev-ref", "HEAD").trim();
    const tip = repo.git("rev-parse", "HEAD").trim();
    await openRepo(repo.path);
    // The pick steps list the loaded log, so make sure it is loaded first.
    await scrollCommitListTo("feat: base");

    await openPalette();
    await $(paletteInput).setValue("start bisect");
    await clickPaletteRow("Start bisect…");
    // Bad first, then good — the order `git bisect start` takes them.
    await $(paletteDialog).$("div*=which commit is BAD").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the bad-commit pick step never appeared",
    });
    await clickPaletteRow("feat: step 8");
    await $(paletteDialog).$("div*=which commit is GOOD").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the good-commit pick step never appeared",
    });
    // Type first: a pick step caps commit rows at CAP.commit (8) and this fixture
    // has 9, so the oldest — the one a bisect's GOOD end always is — is off the
    // list until the query narrows it. Search-first is the palette's contract,
    // not a workaround; the bad end above needs no query because it is the tip.
    await $(paletteInput).setValue("base");
    await clickPaletteRow("feat: base");

    // The bar is the standing signal, and `RepoState::Bisect` is read off
    // BISECT_LOG — so it survives a restart without any state of our own.
    const bar = $('[data-testid="operation-bar"][data-op="Bisect"]');
    await bar.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the bisect operation bar never appeared",
    });
    await browser.waitUntil(async () => repo!.hasRef("refs/bisect/bad"), {
      timeout: 20_000,
      timeoutMsg: "git never recorded a bad ref",
    });
    // git's own numbers, not ours.
    await $('[data-testid="operation-detail"]*=revisions left').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the bar never reported how many revisions are left",
    });

    // One mark, and git records it.
    const before = repo.git("bisect", "log").split("\n").length;
    const detailBefore = await $('[data-testid="operation-detail"]').getText();
    await $('[data-testid="bisect-bad"]').click();
    // The UI, not `git bisect log`. `git bisect <term>` writes BISECT_LOG and
    // only THEN checks out the next revision, and `bisect_mark` runs that
    // subprocess OUTSIDE the backend's repo mutex — so resuming on the log
    // would let the Reset below start a second `git` in this worktree while the
    // first is still checking out, and one of them loses `.git/index.lock`. The
    // bar's progress numbers come from the mark command's own return value, so
    // they cannot change until the whole call returned. A fresh `$()` per poll
    // rather than a handle taken before the click, so the read cannot depend on
    // WebdriverIO's stale-element refetch behaving a particular way.
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="operation-detail"]').getText()) !== detailBefore,
      {
        timeout: 20_000,
        timeoutMsg: "the bisect progress never advanced after marking a revision",
      },
    );
    expect(repo.git("bisect", "log").split("\n").length).toBeGreaterThan(before);

    // Reset — NOT the generic abort, which hard-resets to the detached commit
    // being tested. It confirms first.
    await stubNativeDialogs();
    await $('[data-testid="bisect-reset"]').click();
    await browser.waitUntil(async () => !(await bar.isExisting()), {
      timeout: 20_000,
      timeoutMsg: "the bisect bar never went away after reset",
    });
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(startBranch);
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(tip);
    expect(repo.hasRef("refs/bisect/bad")).toBe(false);
  });

  it("picks up a bisect started outside the app", async () => {
    repo = bisectRepo();
    // Exactly the case a parallel state file would get wrong: git owns this one
    // entirely, and the app has never seen it.
    repo.git("bisect", "start", "HEAD", "HEAD~8");

    await openRepo(repo.path);
    await $('[data-testid="operation-bar"][data-op="Bisect"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "a bisect started in a terminal was not picked up",
    });
    await $('[data-testid="bisect-good"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the bisect bar offered no way to mark the revision",
    });
    // The generic abort must not be reachable for this state.
    expect(await $('[data-testid="operation-abort"]').isExisting()).toBe(false);
  });
});
