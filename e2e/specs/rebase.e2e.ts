import { browser, $, expect } from "@wdio/globals";
import { cherryRepo, rebaseConflictRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsClickMenuItem, executeOnce,
} from "../support/app";

describe("interactive rebase", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("squashes HEAD into its parent from the history menu", async () => {
    repo = cherryRepo(); // main: 3 commits, HEAD = "fix: update a.txt"
    await openRepo(repo.path);
    await stubNativeDialogs({ promptText: "squashed by e2e" });
    await switchScreen("history");
    const headRow = $('[data-testid="commit-row"]*=fix: update a.txt');
    await headRow.waitForDisplayed({ timeout: 15_000, timeoutMsg: "HEAD row missing" });
    await jsContextMenu('[data-testid="commit-row"]', { text: "fix: update a.txt" });
    await jsClickMenuItem("Squash this commit into its parent");
    // AppShell auto-switches to the rebase screen with a prefilled plan
    await $('[data-testid="rebase-row"]').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "rebase plan never appeared",
    });
    await $('[data-testid="rebase-start"]').click();
    await browser.waitUntil(
      async () => repo.git("rev-list", "--count", "HEAD").trim() === "2",
      { timeout: 20_000, timeoutMsg: "squash rebase did not complete" },
    ); // repo-truth wait: completion has no single UI signal
    expect(repo.git("log", "-1", "--pretty=%B")).toContain("squashed by e2e");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("aborting a conflicted rebase restores HEAD", async () => {
    repo = rebaseConflictRepo();
    const before = repo.git("rev-parse", "HEAD").trim();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    // "Interactive rebase from here" resolves its base as the target
    // commit's parent — invoking it on the repo's ROOT commit ("feat: base
    // line" has none) silently no-ops (menu handler bails when it can't
    // find a base oid). Target "feat: first edit" instead: its parent is
    // "feat: base line", a valid base, and the resulting 3-row plan covers
    // first edit / middle edit / second edit.
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: first edit" });
    await jsClickMenuItem("Interactive rebase from here");
    await $('[data-testid="rebase-row"]').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "rebase plan never appeared",
    });
    // Drop the MIDDLE commit so the last one conflicts on replay. Dropping
    // the plan's first (oldest) row wouldn't work here: rebase_start resets
    // HEAD to the parent of the first surviving (non-Drop) step, so a
    // leading drop just shifts the reset point and never conflicts — the
    // dropped commit has to sit between two surviving picks.
    const dropRowText = "feat: middle edit";
    // selectByVisibleText doesn't stick on the embedded driver (confirmed
    // empirically: the row's action <select> stayed "pick" afterward), and
    // passing a WebdriverIO element handle into browser.execute isn't
    // supported here either (the tauri driver doesn't resolve it to a live
    // DOM node) — so find the row and its <select> purely in-page by text,
    // same technique as jsContextMenu/jsClickMenuItem, and dispatch the
    // change event ourselves.
    await $(`[data-testid="rebase-row"]*=${dropRowText}`).waitForDisplayed({
      timeout: 10_000, timeoutMsg: "plan row missing",
    });
    // executeOnce: re-dispatching change with the same value is near-benign,
    // but keep every side-effectful script under the no-double-run guard.
    await executeOnce((rowText: string) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="rebase-row"]'));
      const row = rows.find((r) => r.textContent?.includes(rowText));
      const select = row?.querySelector("select") as HTMLSelectElement | null;
      if (!select) throw new Error(`rebase row select not found: ${rowText}`);
      select.value = "drop";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, dropRowText);
    await $('[data-testid="rebase-start"]').click();
    await $('[data-testid="rebase-abort"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "conflict banner (with Abort) never appeared",
    });
    await $('[data-testid="rebase-abort"]').click();
    await browser.waitUntil(
      async () => repo.git("rev-parse", "HEAD").trim() === before,
      { timeout: 20_000, timeoutMsg: "abort did not restore HEAD" },
    );
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
