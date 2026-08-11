import { existsSync } from "node:fs";
import { join } from "node:path";

import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, nestedDirtyRepo, TempRepo } from "../support/tempRepo";
import {
  changeRow,
  confirmCallCount,
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  stagedRow,
  stubNativeDialogs,
  switchScreen,
} from "../support/app";

// PGCheckbox's native <input type="checkbox"> is the only element whose
// programmatic click reliably toggles + fires React's onChange (the visible
// box is a sibling span inside the <label>; clicking the row-toggle wrapper
// span itself does not activate the label). The embedded driver's
// elementClick is an in-page el.click(), so targeting the visually hidden
// input works even though it has pointer-events: none.
const rowToggle = (list: "staged-list" | "changes-list", p: string) =>
  $(
    `[data-testid="${list}"] [data-path="${p}"] [data-testid="row-toggle"] input`,
  );

describe("status & staging", () => {
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

  it("buckets modified / untracked / staged correctly", async () => {
    await expect(changeRow("a.txt")).toBeDisplayed(); // modified
    await expect(changeRow("new.txt")).toBeDisplayed(); // untracked
    await expect(stagedRow("staged.txt")).toBeDisplayed(); // staged
    await expect(stagedRow("a.txt")).not.toBeExisting();
  });

  it("stages and unstages a file via the row checkbox", async () => {
    await rowToggle("changes-list", "a.txt").click();
    await stagedRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "a.txt did not move to staged list after toggle",
    });

    await rowToggle("staged-list", "a.txt").click();
    await changeRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "a.txt did not move back to changes list after toggle",
    });
    await expect(stagedRow("a.txt")).not.toBeExisting();

    // repo truth: a.txt is worktree-modified but no longer staged after the
    // round-trip (dirtyRepo's staged.txt legitimately stays in the index)
    expect(repo.git("status", "--porcelain", "--", "a.txt").trim()).toBe(
      "M a.txt",
    );
  });

  it("discards a modified file via context menu", async () => {
    await jsContextMenu('[data-testid="changes-list"] [data-path="a.txt"]');
    // Menu items are divs with the label in an inner <span> (no native menu;
    // useContextMenu renders a portal).
    await $("span=Discard changes").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Discard changes menu item never appeared",
    });
    await jsClickMenuItem("Discard changes");
    await browser.waitUntil(
      async () => !(await changeRow("a.txt").isExisting()),
      { timeout: 30_000, timeoutMsg: "a.txt still listed after discard" },
    );
    // verify on disk: content back to committed v2
    expect(repo.read("a.txt")).toBe("alpha v2\n");
  });

  // #67: discard used to report success and delete nothing for an untracked
  // path — `checkout_index` has no index entry to restore from — so the file
  // stayed on disk after the app said the changes were lost.
  it("deletes an untracked file via context menu", async () => {
    await stubNativeDialogs({ confirm: true });
    await jsContextMenu('[data-testid="changes-list"] [data-path="new.txt"]');
    // Untracked has nothing to restore from, so the item reads Delete, not
    // Discard changes, and goes through a confirm.
    await $("span=Delete file…").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Delete file… menu item never appeared",
    });
    await jsClickMenuItem("Delete file…");

    await browser.waitUntil(
      async () => !(await changeRow("new.txt").isExisting()),
      { timeout: 30_000, timeoutMsg: "new.txt still listed after delete" },
    );
    expect(await confirmCallCount()).toBe(1);
    // repo truth: gone from the worktree, not merely dropped from the list
    expect(existsSync(join(repo.path, "new.txt"))).toBe(false);
    expect(repo.git("status", "--porcelain", "--", "new.txt").trim()).toBe("");
  });
});

// #61 A5/A6: the tree can stage. Needs its own fixture — dirtyRepo's files are
// all at the repo root, so it renders no folder row to act on.
describe("folder staging in tree view", () => {
  let repo: TempRepo;

  // All selectors are lazy: `$` needs an initialized browser, which does not
  // exist while the describe body is being evaluated.
  // PGIconButton forwards `title` only, so that is the handle for the toggles.
  const viewToggle = (mode: "Tree view" | "Flat view") => $(`[title="${mode}"]`);
  const folderRow = () => $('[data-testid="changes-list"] [data-path="src"]');
  // Tree rows reuse PGChangeRow's row-toggle testid, so this mirrors rowToggle.
  const folderToggle = () =>
    $(
      '[data-testid="changes-list"] [data-path="src"] [data-testid="row-toggle"] input',
    );

  /** Staged paths per git itself — the acceptance signal. */
  const stagedPaths = () =>
    repo
      .git("diff", "--cached", "--name-only")
      .split("\n")
      .filter(Boolean)
      .sort();

  beforeEach(async () => {
    repo = nestedDirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the nested changes",
    });
    await viewToggle("Tree view").click();
    await folderRow().waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "tree mode never rendered the src folder row",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("stages a whole folder from the tree checkbox", async () => {
    await folderToggle().click();

    await stagedRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "folder checkbox did not stage src/one.txt",
    });
    // repo truth: both files under src staged, the clean root file untouched.
    expect(stagedPaths()).toEqual(["src/one.txt", "src/two.txt"]);
  });

  it("offers stage-all on a folder's context menu", async () => {
    // Before #61 a folder right-click produced an EMPTY menu.
    await jsContextMenu('[data-testid="changes-list"] [data-path="src"]');
    await $("span*=Stage 2 files").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "folder context menu never offered Stage 2 files",
    });
    await jsClickMenuItem("Stage 2 files");

    await stagedRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "folder context menu did not stage the folder",
    });
    expect(stagedPaths()).toEqual(["src/one.txt", "src/two.txt"]);
  });

  it("keeps the same files visible when switching back to flat", async () => {
    await viewToggle("Flat view").click();
    // Flat mode has file rows only — the folder row must be gone, both files
    // still listed by full path.
    await browser.waitUntil(async () => !(await folderRow().isExisting()), {
      timeout: 30_000,
      timeoutMsg: "folder row still present in flat mode",
    });
    await expect(changeRow("src/one.txt")).toBeDisplayed();
    await expect(changeRow("src/two.txt")).toBeDisplayed();
  });
});
