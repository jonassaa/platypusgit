// Diff navigation: a diff opens AT its first change, and F7 carries on into the
// next file instead of dead-ending (issue 188).
//
// Both halves need a real webview, and for the same reason: they depend on a
// MEASURED viewport. `useHunkNav`'s auto-open is gated on `diffOpenReady`, whose
// viewport term is 0 in jsdom (no layout) and 0 on WebKitGTK too until the first
// measurement lands — and WebKitGTK 605 has no ResizeObserver, so the measurement
// arriving at all is exactly what a component test cannot show. The scroll itself
// is offset-based over the whole-file row model, so the number this asserts
// (`scrollTop > 0`) can only be produced by real heights over a real viewport.
//
// Chords go through jsChord (window-level keydown — the embedded driver cannot
// synthesize F7 reliably through the actions endpoint, and the app listens on
// window either way); everything downstream of AppShell's listener is real app
// code.

import { browser, $, $$, expect } from "@wdio/globals";
import { basicRepo, type TempRepo } from "../support/tempRepo";
import {
  openRepo,
  resetApp,
  jsChord,
  switchScreen,
  watchFlashes,
  flashLog,
  waitForSelector,
} from "../support/app";

const filesPane = '[data-pg-pane="diff.files"]';
const fileRows = `${filesPane} [data-pg-row]`;
const selectedRow = `${filesPane} [data-pg-row][data-selected]`;
// FocusableScroll's ariaLabel — the diff pane's own scroll container.
const diffScroll = '[aria-label="Diff"]';
const activeHunk = (i: number) => `[data-hunk-index="${i}"][data-hunk-active]`;

const FILES = ["one.txt", "two.txt"] as const;
const LINES = 260;
const body = () => Array.from({ length: LINES }, (_, i) => `line ${i + 1}`);

/**
 * Two files, each with two changes and the FIRST one 100 lines down.
 *
 * Deep on purpose: whole-file mode renders every line, so ~100 diff rows (well
 * over 1500px) sit above the first change while the e2e window is 1200×800 — it
 * cannot be on screen at rest, so `scrollTop > 0` can only mean something scrolled
 * to it. Two hunks per file so F7 has somewhere to go inside the file before it
 * reaches the end of one, and the changes are 100 lines apart so no plausible
 * context width merges them into one hunk.
 */
function deepChangeRepo(): TempRepo {
  const r = basicRepo();
  for (const f of FILES) r.commitFile(f, body().join("\n") + "\n", `feat: add ${f}`);
  for (const f of FILES) {
    const l = body();
    l[99] = "line 100 CHANGED";
    l[199] = "line 200 CHANGED";
    r.write(f, l.join("\n") + "\n");
  }
  return r;
}

/** The file list's rendered order, which is `get_status`'s, not the fixture's. */
async function listedFiles(): Promise<string[]> {
  const rows = await $$(fileRows);
  const out: string[] = [];
  for (const row of rows) out.push((await row.getText()).trim());
  return out;
}

async function openDiffScreen(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  // The activity bar rather than a chord: how the screen is reached is incidental
  // here, and both routes go through AppShell's enterScreen, so focus lands on
  // the primary pane (diff.files) — one of useHunkNav's paneIds, and F7 is
  // pane-scoped.
  await switchScreen("diff");
  await $(filesPane).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "Diff screen never appeared",
  });
}

describe("diff navigation (issue 188)", () => {
  let repo: TempRepo;

  afterEach(async () => {
    repo?.dispose();
    await resetApp();
  });

  it("opens a diff scrolled to its first change, with that change marked", async () => {
    repo = deepChangeRepo();
    await openDiffScreen(repo);

    await waitForSelector(
      activeHunk(0),
      "the diff did not open marked at its first change",
    );
    // The mark alone would also be true of a cursor that moved with no scroll, so
    // assert the pane actually moved. The first change is 100 lines down.
    const scrollTop = await browser.execute(
      (sel: string) => document.querySelector(sel)?.scrollTop ?? -1,
      diffScroll,
    );
    expect(scrollTop).toBeGreaterThan(0);
  });

  it("F7 carries into the next file at its first change, and stops at the last", async () => {
    repo = deepChangeRepo();
    await openDiffScreen(repo);
    await waitForSelector(
      activeHunk(0),
      "the diff did not open marked at its first change",
    );
    const listed = await listedFiles();
    expect(listed.length).toBe(2);
    const [first, second] = listed;
    await watchFlashes();

    // Inside the file first: the cursor opened on change 1, so one F7 reaches the
    // last change rather than the second.
    await jsChord("F7");
    await waitForSelector(activeHunk(1), "F7 did not advance to the second change");

    // At the last change, F7 announces the crossing WITHOUT performing it. Before
    // issue 188 this press was a silent no-op that still claimed the chord.
    await jsChord("F7");
    expect(await $(selectedRow).getText()).toContain(first);
    const hint = await flashLog();
    expect(hint[hint.length - 1]).toContain("again for the next file");

    // The next press opens the next file, moving the FILE LIST selection too.
    await jsChord("F7");
    await browser.waitUntil(
      async () => (await $(selectedRow).getText()).includes(second),
      {
        timeout: 10_000,
        timeoutMsg: `F7 did not carry from ${first} into ${second}`,
      },
    );
    await waitForSelector(
      activeHunk(0),
      "the next file did not open at its first change",
    );

    // ...and the end of the LIST stops, rather than cycling back to the first file.
    await jsChord("F7");
    await waitForSelector(
      activeHunk(1),
      "F7 did not advance inside the second file",
    );
    await jsChord("F7");
    const last = await flashLog();
    expect(last[last.length - 1]).toBe("Last file — no more changes");
    expect(await $(selectedRow).getText()).toContain(second);
  });
});
