// "Yes, really, show me." — the blob ceiling, and the way past it (#385, #396).
//
// The backend declines to diff a blob over `MAX_WORKDIR_BLOB` (5 MB), and #385
// made it say so honestly rather than calling a checked-in `generated.sql`
// "binary". What that fix deliberately left out was any way to act on it, so
// leaving the app was the only route past a ceiling that is a GUESS about
// intent — and when the guess is wrong it is completely wrong.
//
// This is the end-to-end half that neither the Rust integration tests nor the
// component tests can reach: that a real 6.7 MB blob in a real repository comes
// back refused, that the click sends `raiseFor` across IPC in the shape the
// command expects (a camelCase arg deserialising into `Option<Vec<String>>` is
// exactly the kind of thing only a real invoke proves), and that the pane then
// renders the hunks it previously refused.

import { browser, $, expect } from "@wdio/globals";
import { oversizedBlobRepo, type TempRepo } from "../support/tempRepo";
import { changeRow, openRepo, resetApp, switchScreen } from "../support/app";

/** The commit panel's own diff scroller, so no other pane can satisfy a find. */
const diffScroll = '[aria-label="Diff"]';

/**
 * Wait for one line of diff text to be on screen.
 *
 * `getText()` on the scroller rather than a text selector: WebdriverIO's `*=`
 * compiles only against a tag name or an attribute selector, so
 * `.pg-selectable*=…` is rejected by WebKit as invalid CSS. `getText` is a
 * protocol-level command, so it refetches rather than going dead on a
 * re-render.
 */
async function waitForDiffText(needle: string, msg: string): Promise<void> {
  await browser.waitUntil(
    async () => (await $(diffScroll).getText()).includes(needle),
    { timeout: 30_000, timeoutMsg: msg },
  );
}

describe("the diff blob ceiling", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    // The store reads status at `openRepo`, so the dirty file must exist first —
    // the fixture writes it before returning.
    repo = oversizedBlobRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("generated.sql").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never listed the oversized file",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("refuses the blob honestly, then diffs it when the user insists", async () => {
    await changeRow("generated.sql").click();

    // The refusal names the real reason and the size. "Binary file" here would
    // be the #385 bug — this file is ASCII, we simply declined to read 6.7 MB.
    const notice = $('div*=File too large to diff');
    await notice.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the oversized notice never appeared for a 6.7 MB text file",
    });
    // Sanity that we are looking at the refusal and not a real binary's state.
    expect(await $("body").getText()).not.toContain("Binary diffs aren't shown.");

    // ...and now the half #396 adds: something to do about it.
    const button = $('[data-testid="diff-anyway"]');
    await button.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the notice named a limit with nothing to act on",
    });
    await button.click();

    // The pane renders what it previously refused. One line was added to the
    // fixture, so the waived read is a handful of rows, not six figures — the
    // `INSERT` is the only content in the file that is not the padding line.
    await waitForDiffText(
      "INSERT INTO t VALUES (1);",
      "the waived read never produced the hunk it was asked for",
    );

    // The refusal is gone, and so is the button: there is nothing left to waive.
    //
    // A `waitUntil`, not a bare assert, and this is the whole reason the second
    // test below exists: `CommitPanel`'s diff effect re-runs on every status
    // refresh (its own comment says so — `status` is a dependency on purpose),
    // so the waiver has to ride along on that fetch. When it did not, this pane
    // flipped back to the refusal on its own, milliseconds after the diff
    // arrived — which is exactly what a user would have seen.
    await browser.waitUntil(
      async () =>
        !(await $('[data-testid="diff-anyway"]').isExisting()) &&
        !(await $("body").getText()).includes("File too large to diff"),
      {
        timeout: 15_000,
        timeoutMsg: "the refusal came back after the waived read landed",
      },
    );

    // Repo truth as acceptance: nothing about this is a mutation, so what there
    // is to assert is that reading a 6.7 MB blob did not touch the tree — both
    // fixture files still modified, nothing staged, nothing rewritten.
    const porcelain = repo
      .git("status", "--porcelain")
      .split("\n")
      // Trimmed per line: `.trim()` on the whole output eats the leading space
      // that porcelain's index column IS, which is what makes " M" unstaged.
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
    expect(porcelain).toEqual(["M generated.sql", "M notes.txt"]);
  });

  it("re-refuses after the selection moves away and back", async () => {
    // The waiver is per file, never remembered. It rides along on the SAME
    // file's fetches — that is what keeps a status refresh from throwing the
    // waived read away — and is dropped when the selection moves, so coming back
    // costs a click rather than another silent 6.7 MB read. A waiver that
    // outlived the selection would be an "always diff huge files" setting
    // nobody asked for.
    await changeRow("generated.sql").click();
    await $('[data-testid="diff-anyway"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the action never appeared on first selection",
    });
    await $('[data-testid="diff-anyway"]').click();
    await waitForDiffText("INSERT INTO t VALUES (1);", "the waived read never landed");

    // Move the selection to the ordinary file, then back. The waiver is keyed on
    // the selection, so it is dropped on the way out — no silent 6.7 MB re-read
    // on the way back in.
    await changeRow("notes.txt").click();
    await waitForDiffText("two", "the other file's diff never rendered");
    await changeRow("generated.sql").click();

    await $('[data-testid="diff-anyway"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the ceiling did not re-apply on a fresh fetch",
    });
  });
});
