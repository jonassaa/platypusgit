// Diff text is selectable, and what a copy yields is CODE — no line numbers and
// no +/- markers.
//
// This needs a real webview and cannot be faked in jsdom, for two reasons:
//
//  1. The rule that grants selection lives in a STYLESHEET (`.pg-selectable` in
//     index.css, opting back in from the app-wide `user-select: none` on body).
//     jsdom applies no stylesheet, so a component test can only assert the class
//     is present — never that the cascade actually resolves to a selectable cell
//     in the engine that ships.
//  2. Whether `user-select: none` on the gutters really keeps them OUT of a copy
//     is an engine behaviour, and a WebKit soft spot historically. The component
//     tests model it (`src/test/selectionText.ts` walks the tree the way an engine
//     would); only this spec measures it.
//
// The fixture is deliberately DIGIT-FREE — every code line is a word — so "the
// copied text contains no digit" is an exact statement about line numbers having
// been excluded, with nothing in the code that could satisfy it by accident.
//
// The selection itself is set through the Range API in-page rather than a pointer
// drag: the embedded driver cannot synthesize a reliable press-move-release over
// a windowed list (the same reason `jsContextMenu` and `jsChord` exist), and the
// engine's copy serialisation is what is under test, not its hit-testing.

import { browser, $, expect } from "@wdio/globals";
import { basicRepo, type TempRepo } from "../support/tempRepo";
import {
  openRepo,
  resetApp,
  switchScreen,
  executeOnce,
  jsContextMenu,
  jsClickMenuItem,
  waitForSelector,
} from "../support/app";

const filesPane = '[data-pg-pane="diff.files"]';
const diffScroll = '[aria-label="Diff"]';
const codeCell = `${diffScroll} .pg-selectable`;

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

/**
 * One tracked file of words, with one word changed.
 *
 * No digits anywhere in the content, so the gutters' line numbers are the only
 * possible source of a digit in anything copied out of this diff.
 */
function wordsRepo(): TempRepo {
  const r = basicRepo();
  r.commitFile("words.txt", WORDS.join("\n") + "\n", "feat: add words");
  const next = [...WORDS];
  next[2] = "gamma";
  r.write("words.txt", next.join("\n") + "\n");
  return r;
}

async function openWordsDiff(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  await switchScreen("diff");
  await $(filesPane).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "Diff screen never appeared",
  });
  // No click: words.txt is the fixture's ONLY change, and the Diff screen selects
  // its first file itself (the row comes up `data-selected`), so the diff is
  // already open. This screen's file rows carry no `data-path` either — they are
  // a status mark plus a name — so there would be nothing unambiguous to click,
  // and `*=` text cannot be appended to a descendant chain in the first place.
  await waitForSelector(
    `${filesPane} [data-pg-row][data-selected]`,
    "the Diff screen never auto-selected a file",
  );
  await waitForSelector(codeCell, "the diff never rendered a selectable code cell");
  // Guard the fixture: everything below reads this one file's diff.
  expect(await $(`${filesPane} [data-pg-row][data-selected]`).getText()).toContain(
    "words.txt",
  );
}

/** The engine's computed `user-select` for the first match of `sel`. */
function computedUserSelect(sel: string): Promise<string | null> {
  return browser.execute((s: string) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs.userSelect || cs.webkitUserSelect || null;
  }, sel);
}

/**
 * Select every diff row and return the engine's TWO serialisations of it.
 *
 * `Selection.toString()` is the one that matters: in WebKit it is the selection's
 * plain-text rendering, and it honours `user-select` — which is what a copy puts
 * on the clipboard. `Range.toString()` is the raw text-node walk and ignores CSS
 * entirely. Returning both lets the assertions prove the exclusion is CAUSED by
 * `user-select: none` rather than by a DOM that never held the numbers: the raw
 * walk still sees them, the selection does not.
 *
 * Not read from a `copy` event: per the Clipboard API a copy/cut event's
 * `clipboardData` starts EMPTY (it is write-only, for handlers overriding the
 * payload), so `getData` there returns "" no matter what the selection holds —
 * measured on WebKitGTK 605 before this was rewritten.
 */
function selectAllAndSerialise(
  scrollSel: string,
): Promise<{ selection: string; rawWalk: string }> {
  return executeOnce((sel: string) => {
    const scroller = document.querySelector(sel);
    if (!scroller) throw new Error(`no diff scroller for ${sel}`);
    const range = document.createRange();
    range.selectNodeContents(scroller);
    const selection = window.getSelection();
    if (!selection) throw new Error("no selection object");
    selection.removeAllRanges();
    selection.addRange(range);
    return { selection: selection.toString(), rawWalk: range.toString() };
  }, scrollSel);
}

/** Record what the app asks the clipboard to hold, without touching the real one. */
function recordClipboard(): Promise<null> {
  return executeOnce(() => {
    const w = window as unknown as { __pgCopied?: string[] };
    w.__pgCopied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => {
          w.__pgCopied!.push(t);
          return Promise.resolve();
        },
      },
    });
    return null;
  });
}

function recordedCopies(): Promise<string[]> {
  return browser.execute(
    () => (window as unknown as { __pgCopied?: string[] }).__pgCopied ?? [],
  );
}

describe("diff text selection", () => {
  let repo: TempRepo;

  afterEach(async () => {
    repo?.dispose();
    await resetApp();
  });

  it("resolves the stylesheet to selectable code and unselectable gutters", async () => {
    repo = wordsRepo();
    await openWordsDiff(repo);

    // The two halves of the contract, as the shipping engine resolves them. The
    // body rule (`user-select: none`) is what makes the second half the default,
    // so the first is the one that proves `.pg-selectable` is reaching the cell.
    expect(await computedUserSelect(codeCell)).toBe("text");

    const gutter = await browser.execute((sel: string) => {
      const cell = document.querySelector(sel);
      const row = cell?.parentElement;
      const first = row?.firstElementChild as HTMLElement | undefined;
      if (!first) return null;
      const cs = getComputedStyle(first);
      return cs.userSelect || cs.webkitUserSelect || null;
    }, codeCell);
    expect(gutter).toBe("none");
  });

  it("serialises a selection to the code alone, one row per line", async () => {
    repo = wordsRepo();
    await openWordsDiff(repo);

    const { selection, rawWalk } = await selectAllAndSerialise(diffScroll);

    // Whole-file view, so every line of the file is a row: the unchanged ones,
    // then the change as removed-then-added. Rows come out newline-separated, so
    // this pastes as source rather than as one smeared line.
    expect(selection).toBe("alpha\nbravo\ncharlie\ngamma\ndelta\necho\nfoxtrot\n");

    // Restating the above as the properties that matter, so a failure says which
    // half broke. Every line number is a digit and the fixture has none, which is
    // what makes the digit check exact.
    expect(selection).not.toMatch(/[0-9]/);
    expect(selection).not.toContain("+");
    // U+2212 MINUS SIGN — what PGDiffRow renders for a removed line, not "-".
    expect(selection).not.toContain("−");

    // The proof that `user-select: none` is what did it: the raw text-node walk
    // over the SAME range ignores CSS, and still sees the line numbers. If this
    // ever matches the selection, the gutters stopped being excluded and the
    // checks above went vacuous.
    expect(rawWalk).toMatch(/[0-9]/);
    expect(rawWalk).not.toBe(selection);
  });

  it("copies the whole file's diff from the context menu", async () => {
    repo = wordsRepo();
    await openWordsDiff(repo);
    await recordClipboard();

    await jsContextMenu(diffScroll);
    await jsClickMenuItem("Copy file diff as text");

    await browser.waitUntil(async () => (await recordedCopies()).length > 0, {
      timeout: 10_000,
      timeoutMsg: "the copy menu item never reached the clipboard",
    });
    const [text] = await recordedCopies();
    // Patch shape here, unlike a selection: hunk header, and the +/- prefixes
    // that make it applicable.
    expect(text).toContain("@@");
    expect(text).toContain("-charlie");
    expect(text).toContain("+gamma");
  });
});
