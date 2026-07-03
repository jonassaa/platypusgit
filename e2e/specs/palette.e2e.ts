import { browser, $, $$, expect } from "@wdio/globals";
import {
  basicRepo, branchyRepo, remoteRepo, makeBehind,
  type TempRepo, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, resetApp, openPalette, paletteDialog, paletteInput, jsKey,
} from "../support/app";

/** Click the palette row whose visible label contains `text`. */
async function clickPaletteRow(text: string): Promise<void> {
  const row = $(paletteDialog).$(`[data-pal-index]*=${text}`);
  await row.waitForDisplayed({
    timeout: 10_000, timeoutMsg: `palette row "${text}" never appeared`,
  });
  await row.click();
}

describe("command palette", () => {
  let repo: TempRepo | null = null;
  let pair: RemotePair | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose(); repo = null;
    pair?.dispose(); pair = null;
  });

  it("opens with quick actions; Escape on the root closes it", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteDialog).$("div*=Quick actions").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "Quick actions section missing on empty query",
    });
    await jsKey(paletteInput, "Escape");
    await browser.waitUntil(async () => !(await $(paletteDialog).isExisting()), {
      timeout: 10_000, timeoutMsg: "palette did not close on Escape",
    });
  });

  it("navigation command switches screens", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("reflog");
    await clickPaletteRow("Go to Reflog");
    // Reflog "loaded" wait copied verbatim from e2e/specs/reflog.e2e.ts: entry
    // rows are PGCommitRow (`data-testid="commit-row"`), and basicRepo's HEAD~1
    // commit subject ("feat: add b.txt") is reflected in its reflog message too.
    await $('[data-testid="commit-row"]*=feat: add b.txt').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "reflog screen never showed entries",
    });
  });

  it("direct action: fetch-all discovers the remote commit", async () => {
    pair = remoteRepo();
    makeBehind(pair);
    await openRepo(pair.repo.path);
    await openPalette();
    await $(paletteInput).setValue("fetch all");
    await clickPaletteRow("Fetch all remotes");
    await $("span*=↓1").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "behind badge never appeared after palette fetch-all",
    });
  });

  it("pick step: checkout branch", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("checkout branch");
    await clickPaletteRow("Checkout branch…");
    // now inside the pick step — branch rows are data-pal-type="branch"
    const branchRow = $(paletteDialog).$('[data-pal-type="branch"]*=feature');
    await branchRow.waitForDisplayed({
      timeout: 10_000, timeoutMsg: "feature branch not offered in pick step",
    });
    await branchRow.click();
    await browser.waitUntil(
      async () => repo!.git("symbolic-ref", "--short", "HEAD").trim() === "feature",
      { timeout: 20_000, timeoutMsg: "checkout never happened" },
    );
    await $('[data-testid="branch-chip"]*=feature').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "branch chip did not update",
    });
  });

  it("input step: create branch", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("create branch");
    await clickPaletteRow("Create branch…");
    await $(paletteDialog).$("div*=Press Enter to confirm").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "input step never appeared",
    });
    await $(paletteInput).setValue("palette-branch");
    await jsKey(paletteInput, "Enter");
    await browser.waitUntil(
      async () => repo!.hasRef("refs/heads/palette-branch"),
      { timeout: 20_000, timeoutMsg: "branch was never created" },
    );
  });

  it("two-step danger flow: hard reset to a picked commit", async () => {
    repo = basicRepo();
    const target = repo.git("rev-parse", "HEAD~1").trim();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("reset current");
    await clickPaletteRow("Reset current branch to…");
    await clickPaletteRow("feat: add b.txt"); // pick the HEAD~1 commit by subject
    await clickPaletteRow("Hard");            // second step: mode pick
    await browser.waitUntil(
      async () => repo!.git("rev-parse", "HEAD").trim() === target,
      { timeout: 20_000, timeoutMsg: "hard reset never moved HEAD" },
    );
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("chips filter results to one type", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("a"); // matches branches, files, commits, commands
    await $(paletteDialog).$("button*=Branches").click();
    await $(paletteDialog).$('[data-pal-type="branch"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "no branch rows under Branches chip",
    });
    const types = await $(paletteDialog).$$("[data-pal-type]").map(
      (el) => el.getAttribute("data-pal-type"),
    );
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === "branch")).toBe(true);
  });

  it("frecency: an executed command shows under Recent on reopen", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await openPalette();
    await $(paletteInput).setValue("refresh repo");
    await clickPaletteRow("Refresh repository"); // direct, safe no-op
    await browser.waitUntil(async () => !(await $(paletteDialog).isExisting()), {
      timeout: 10_000, timeoutMsg: "palette did not close after direct command",
    });
    await openPalette();
    await $(paletteDialog).$("div*=Recent").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "Recent section missing after command use",
    });
    await $(paletteDialog).$("[data-pal-index]*=Refresh repository").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "executed command not listed under Recent",
    });
    const raw = await browser.execute(() =>
      localStorage.getItem("pg-palette-frecency"),
    );
    expect(raw).toContain("action:refresh");
  });
});
