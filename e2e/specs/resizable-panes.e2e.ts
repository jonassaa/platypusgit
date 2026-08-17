import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  jsDoubleClick,
  jsDragHandle,
  openRepo,
  resetApp,
  switchScreen,
} from "../support/app";

/**
 * Container-relative pane clamp (#162), on the real webview.
 *
 * This lives in e2e rather than jsdom for one reason: **the clamp needs a
 * measurement, and jsdom has none.** The component tests stub `clientWidth` to
 * exercise the arithmetic; only a real webview can show that the measurement
 * itself arrives — and WebKitGTK 605, which is what CI and the Docker image run,
 * has no `ResizeObserver`, which is exactly the environment where a first
 * measurement placed behind a capability check would silently never happen.
 *
 * Each test drags a pane far past its old hard-coded maximum and then asserts
 * the two halves of the invariant:
 *
 * 1. the pane really did grow past that old ceiling — it is gone, not raised;
 * 2. the sibling still holds its floor, so the handle BETWEEN them is still on
 *    screen and still draggable. Skip the initial measurement and this is the
 *    assertion that fails: the clamp goes unbounded, the sibling is squeezed to
 *    zero, and the drag becomes unrecoverable — the failure the issue is about.
 */

/** Measured content extent of a pane's flex container, on one axis. */
function containerExtent(paneSelector: string, axis: "width" | "height") {
  return browser.execute(
    (sel: string, prop: string) => {
      const pane = document.querySelector(sel);
      const parent = pane?.parentElement as HTMLElement | null | undefined;
      if (!parent) return 0;
      return prop === "width" ? parent.clientWidth : parent.clientHeight;
    },
    paneSelector,
    axis,
  );
}

/** `getSize` after waiting for the drag's re-render to land.
 *
 * A `mousemove` is a CONTINUOUS event, so React schedules its update rather than
 * flushing it inside the dispatch — the width is asserted, never assumed. */
async function waitSize(
  selector: string,
  axis: "width" | "height",
  predicate: (n: number) => boolean,
  what: string,
): Promise<number> {
  await browser.waitUntil(
    async () => predicate(await $(selector).getSize(axis)),
    { timeout: 10_000, timeoutMsg: what },
  );
  return $(selector).getSize(axis);
}

const filesPane = '[data-pg-pane="diff.files"]';
const diffPane = '[data-pg-pane="diff.view"]';
const listHandle = '[data-testid="diff-list-resize"]';

/** The Diff screen's file list: default 280, min 180, old hard cap 600. */
const DIFF_LIST_DEFAULT = 280;
const DIFF_LIST_OLD_MAX = 600;
/** What the Diff screen reserves for the diff beside the list. */
const DIFF_VIEW_MIN = 360;
/** `PANE_HANDLE_PX` — the handle needs room too, and the clamp accounts for it. */
const HANDLE = 4;
/** Rounding + a 1px pane border; the assertions are about px, not sub-px. */
const SLOP = 3;

/** History's bottom detail panel keeps this much commit list above it. */
const HISTORY_LIST_MIN_H = 200;

describe("resizable panes", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("drags the file list past its old 600px cap while the diff keeps its floor", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("diff");
    await $(filesPane).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "Diff screen's file list pane never appeared",
    });

    const container = await containerExtent(filesPane, "width");
    // Precondition, asserted rather than assumed: the window has to be wide
    // enough that the OLD ceiling was the binding constraint, or this test
    // proves nothing about having removed it.
    expect(container).toBeGreaterThan(DIFF_LIST_OLD_MAX + DIFF_VIEW_MIN);

    // Far more than any container can grant — the clamp decides where it lands.
    await jsDragHandle(listHandle, 2000);

    // The old ceiling is gone, and the new one is the container minus what the
    // diff needs. The pane's own min never enters into it at this width.
    const expected = container - DIFF_VIEW_MIN - HANDLE;
    const listW = await waitSize(
      filesPane,
      "width",
      (n) => n > DIFF_LIST_OLD_MAX,
      `file list never grew past its old ${DIFF_LIST_OLD_MAX}px cap`,
    );
    expect(Math.abs(listW - expected)).toBeLessThanOrEqual(SLOP);

    // The other half: the diff is still there, at its floor. A skipped
    // measurement lands this at 0 with the handle off the container's edge.
    const diffW = await $(diffPane).getSize("width");
    expect(diffW).toBeGreaterThanOrEqual(DIFF_VIEW_MIN);
    // Nothing overflowed the container: the two panes plus the handle fill it.
    expect(listW + diffW).toBeLessThanOrEqual(container + SLOP);

    // Still reversible — the whole point of keeping the sibling non-zero.
    await jsDragHandle(listHandle, -300);
    const narrowed = await waitSize(
      filesPane,
      "width",
      (n) => Math.abs(n - (listW - 300)) <= SLOP,
      "dragging the handle back never narrowed the file list",
    );
    expect(await $(diffPane).getSize("width")).toBeGreaterThan(diffW);
    expect(narrowed).toBeLessThan(listW);

    // Double-click resets that pane to its default.
    await jsDoubleClick(listHandle);
    await waitSize(
      filesPane,
      "width",
      (n) => Math.abs(n - DIFF_LIST_DEFAULT) <= SLOP,
      `double-clicking the handle never reset the pane to ${DIFF_LIST_DEFAULT}px`,
    );
  });

  it("clamps History's bottom panel against the container's HEIGHT", async () => {
    // The same hook sizes a pane vertically here, and reading the wrong axis is
    // invisible in a wide-and-short window until you over-drag: a width-derived
    // cap would let the panel grow past the whole viewport and take the commit
    // list with it.
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("history");
    const handle = '[data-testid="history-detail-resize"]';
    await $(handle).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "History's detail panel resize handle never appeared",
    });

    const detail = '[data-testid="history-detail"]';
    const containerH = await containerExtent(detail, "height");
    const containerW = await containerExtent(detail, "width");
    // The window is wider than it is tall, so a width-derived clamp would be
    // visibly wrong — which is what makes this an axis test.
    expect(containerW).toBeGreaterThan(containerH);

    // The handle sits ABOVE the panel it sizes, so dragging UP grows it.
    await jsDragHandle(handle, -2000, "y");

    const expected = containerH - HISTORY_LIST_MIN_H - HANDLE;
    const detailH = await waitSize(
      detail,
      "height",
      (n) => Math.abs(n - expected) <= SLOP,
      `detail panel never settled at ${expected}px (container ${containerH}px)`,
    );
    expect(detailH).toBeLessThan(containerH);
    expect(
      await $('[data-pg-pane="history.list"]').getSize("height"),
    ).toBeGreaterThanOrEqual(HISTORY_LIST_MIN_H);
  });
});
