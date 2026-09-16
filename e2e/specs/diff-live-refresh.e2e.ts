// A background refresh must not tear down the diff pane the reader is using (#470).
//
// Reported on WSL2/WebKitGTK: the Commit tab's diff "flickers" constantly and
// will not stay scrolled. The cause is not the webview. `CommitPanel`'s diff
// effect lists the `status` ARRAY in its deps as the signal that the selected
// file's staging state moved, and `refreshStatus` replaces that array on every
// refresh — including the background ones `useFsWatch` runs for every
// filesystem event. So each event refetched the diff, and while the refetch was
// in flight the scroll container's children were swapped for a spinner: the
// content collapsed to one row, the engine clamped `scrollTop` to 0, and the
// reader was returned to the top of the file with a blank frame on the way.
//
// Measured from the reporter's own screen capture: 13 fully blank episodes in
// 7.7s, 33-300ms each.
//
// This has to be an e2e test. The chain runs from a real inotify event, through
// the Rust watcher and the `fs://changed` IPC event, into a React refetch, and
// the thing that breaks is what the ENGINE does to `scrollTop` when a scroll
// container's content collapses — none of which jsdom has.
//
// The sampler runs in-page on `requestAnimationFrame` rather than polling from
// the driver: a 33ms blank is one frame, and a WebDriver round trip cannot be
// relied on to land inside it.

import { browser, $, expect } from "@wdio/globals";
import { TempRepo } from "../support/tempRepo";
import { changeRow, executeOnce, openRepo, resetApp, switchScreen } from "../support/app";

const diffScroll = '[aria-label="Diff"]';

function bigFile(tag: string, n: number): string {
  return (
    Array.from({ length: n }, (_, i) => `export const item${i} = "${tag}-${i}";`).join("\n") +
    "\n"
  );
}

const BIG_OLD = bigFile("old", 400);
const BIG_NEW = (() => {
  const lines = BIG_OLD.split("\n");
  lines[380] = 'export const item380 = "CHANGED";';
  return lines.join("\n");
})();

/** Two modified files; the big one needs scrolling to read, like the report. */
function probeRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("big.ts", BIG_OLD, "feat: big");
  r.commitFile("small.ts", "export const a = 1;\nexport const b = 2;\n", "feat: small");
  r.write("big.ts", BIG_NEW);
  r.write("small.ts", "export const a = 1;\nexport const b = 99;\n");
  return r;
}

interface Sample {
  t: number;
  rows: number;
  scrollTop: number;
  scrollHeight: number;
}

describe("diff pane survives a background refresh", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = probeRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("big.ts").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the changes list",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("keeps its rows and its scroll position when the watcher refreshes", async () => {
    await changeRow("big.ts").click();
    await $(`${diffScroll} .pg-selectable`).waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "big.ts diff never rendered",
    });

    // Read partway down the file, as the reporter was doing.
    await executeOnce((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.5);
      el.dispatchEvent(new Event("scroll"));
    }, diffScroll);

    // Sample every frame from here on.
    await executeOnce((sel: string) => {
      const w = window as unknown as { __probe?: Sample[]; __probeStop?: boolean };
      w.__probe = [];
      w.__probeStop = false;
      const t0 = performance.now();
      const tick = () => {
        if (w.__probeStop) return;
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          w.__probe!.push({
            t: Math.round(performance.now() - t0),
            rows: el.querySelectorAll(".pg-selectable").length,
            scrollTop: Math.round(el.scrollTop),
            scrollHeight: el.scrollHeight,
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, diffScroll);

    const before = (await browser.execute((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      return { scrollTop: Math.round(el.scrollTop), rows: el.querySelectorAll(".pg-selectable").length };
    }, diffScroll)) as { scrollTop: number; rows: number };

    // A filesystem event that changes NOTHING about the status: same bytes, new
    // mtime. The watcher fires, `refreshStatus` replaces the array, and every
    // status field is identical — so nothing the reader can see should move.
    repo.write("big.ts", BIG_NEW);

    // Long enough to cover the 400ms watcher debounce plus the refetch.
    await browser.waitUntil(
      async () =>
        ((await browser.execute(
          () => (window as unknown as { __probe: Sample[] }).__probe.length,
        )) as number) > 120,
      { timeout: 20_000, timeoutMsg: "the in-page sampler never collected enough frames" },
    );

    const samples = (await browser.execute(() => {
      const w = window as unknown as { __probe: Sample[]; __probeStop?: boolean };
      w.__probeStop = true;
      return w.__probe;
    })) as Sample[];

    const blank = samples.filter((s) => s.rows === 0);
    const minRows = Math.min(...samples.map((s) => s.rows));
    const tops = [...new Set(samples.map((s) => s.scrollTop))];
    // eslint-disable-next-line no-console
    console.log(
      `[470] frames=${samples.length} blankFrames=${blank.length} minRows=${minRows} ` +
        `scrollTops=${JSON.stringify(tops.slice(0, 12))} before=${JSON.stringify(before)}`,
    );

    // The pane never empties...
    expect(blank.length).toBe(0);
    // ...and the reader stays where they were reading.
    expect(Math.abs(samples[samples.length - 1].scrollTop - before.scrollTop)).toBeLessThan(40);
  });
});
