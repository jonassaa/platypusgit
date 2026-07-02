import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

const stagedRow = (p: string) =>
  $(`[data-testid="staged-list"] [data-path="${p}"]`);
const changeRow = (p: string) =>
  $(`[data-testid="changes-list"] [data-path="${p}"]`);

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

/** Open a context menu via an in-page `contextmenu` MouseEvent.
 *
 * This is the one interaction that cannot be a real WebDriver action: the
 * embedded driver's actions endpoint only synthesizes mousedown/mouseup/
 * click events and never `contextmenu` (verified in
 * tauri-plugin-wdio-webdriver 1.2.0 executor source and empirically —
 * `click({ button: "right" })` completes without error but no menu opens). */
const jsContextMenu = (selector: string) =>
  browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`jsContextMenu: element not found: ${sel}`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        button: 2,
      }),
    );
  }, selector);

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
    const discardItem = $("span=Discard changes");
    await discardItem.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Discard changes menu item never appeared",
    });
    await discardItem.click();
    await browser.waitUntil(
      async () => !(await changeRow("a.txt").isExisting()),
      { timeout: 30_000, timeoutMsg: "a.txt still listed after discard" },
    );
    // verify on disk: content back to committed v2
    expect(repo.read("a.txt")).toBe("alpha v2\n");
  });
});
