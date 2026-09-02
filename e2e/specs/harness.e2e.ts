import { browser, $, expect } from "@wdio/globals";
import { buildExecuteOnceScript, executeOnce } from "../support/app";

/** A detached node's marker, unique to this file so no app selector can hit it. */
const SWAPPED = '[data-pg-harness-swap="1"]';

/** Mount a fresh marker node, REPLACING any previous one.
 *
 *  Deliberately `remove()` + `appendChild` rather than editing in place: that
 *  is what React does when a conditional branch flips (`CommitPanel` unmounts
 *  its clean-tree `PGEmpty` on every refresh, because it gates the branch on
 *  `!loading`), and a node identity change is the whole subject here. */
const mountMarker = () =>
  executeOnce((sel: string) => {
    document.querySelector(sel)?.remove();
    const el = document.createElement("div");
    el.setAttribute("data-pg-harness-swap", "1");
    el.textContent = "harness marker";
    document.body.appendChild(el);
    return true;
  }, SWAPPED);

const removeMarker = () =>
  executeOnce((sel: string) => {
    document.querySelector(sel)?.remove();
    return true;
  }, SWAPPED);

/**
 * Self-test for the stale-handle wait guard (issue #364).
 *
 * `isDisplayed` resolves its selector exactly once and caches `elementId`; a
 * detached node then answers "not displayed" without raising stale, so
 * WebdriverIO never refetches and `waitForDisplayed` polls a dead node for its
 * whole budget. That is the mechanism behind every #364 sighting — a wait that
 * gives up while the screen is right — and `installStaleProofWaits` (installed
 * by the conf's `before` hook) removes it by re-resolving per poll.
 *
 * Both facts are pinned here because both can change under us: a webdriverio
 * release that makes `isDisplayed` refetch would make the control test fail,
 * which is the signal to delete the override rather than keep carrying it.
 */
describe("harness: stale-handle waits", () => {
  afterEach(async () => {
    await removeMarker();
  });

  it("control: a handle bound to a swapped-out node reports not-displayed, and never refetches", async () => {
    await mountMarker();
    const handle = await $(SWAPPED);
    // Binds `handle.elementId` to the node that exists right now.
    expect(await handle.isDisplayed()).toBe(true);

    // The swap: same selector, different DOM node — a re-render, in one step.
    await mountMarker();

    // The bug class, deterministically. No stale error is raised (which is why
    // WebdriverIO's error handler never refetches), and no amount of waiting
    // would change the answer.
    expect(await handle.isDisplayed()).toBe(false);
    // ...while the element the caller asked for is on screen the whole time.
    expect(await $(SWAPPED).isDisplayed()).toBe(true);
  });

  it("waitForDisplayed re-resolves, so a swapped node no longer kills the wait", async () => {
    await mountMarker();
    const handle = await $(SWAPPED);
    expect(await handle.isDisplayed()).toBe(true);
    await mountMarker();

    // The same dead handle the control test just proved is stuck. Without the
    // override this is a guaranteed 3s timeout; with it, the poll re-runs the
    // selector and matches the live node.
    expect(await handle.waitForDisplayed({ timeout: 3_000 })).toBe(true);
  });

  it("still fails when the element is genuinely gone", async () => {
    // The override must not turn a real absence into a pass — the whole point
    // of the gate is that a wait still reports a broken screen.
    await removeMarker();
    // try/catch rather than `expect(...).rejects`: `expect` here is
    // expect-webdriverio, which awaits a promise argument for its own element
    // matchers, so the plain-promise shape is not worth depending on.
    let message = "";
    try {
      await $(SWAPPED).waitForDisplayed({
        timeout: 1_000,
        timeoutMsg: "absent, as expected",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("absent, as expected");
  });

  it("reverse waits still see a removed node as gone", async () => {
    // `reverse` stays on the original implementation (a dead handle already
    // answers what it is waiting for), so pin that it kept working.
    await mountMarker();
    const handle = await $(SWAPPED);
    expect(await handle.isDisplayed()).toBe(true);
    await removeMarker();
    expect(
      await handle.waitForDisplayed({ reverse: true, timeout: 3_000 }),
    ).toBe(true);
  });
});

/**
 * Self-test for the executeOnce retry guard (issue #35).
 *
 * On CI (xvfb) an in-page eval regularly finishes later than the driver's
 * script timeout; the driver reports a timeout and WebdriverIO retries the
 * command, re-running a script whose side effects already happened. These
 * tests simulate that retry deterministically — same script, same token,
 * executed twice — which is indistinguishable in-page from the real thing.
 */
describe("harness: executeOnce retry guard", () => {
  it("control: an unguarded replay double-runs the side effect", async () => {
    // The bug class this guard exists for — proves the probe is sensitive.
    const raw = (n: number) => {
      const w = window as unknown as Record<string, number>;
      w.__pgOnceControl = (w.__pgOnceControl ?? 0) + n;
      return w.__pgOnceControl;
    };
    await browser.execute(raw, 3);
    await browser.execute(raw, 3);
    const control = await browser.execute(
      () => (window as unknown as Record<string, number>).__pgOnceControl,
    );
    expect(control).toBe(6);
  });

  it("replaying the same token skips the effect and returns the first result", async () => {
    const script = buildExecuteOnceScript((n: number) => {
      const w = window as unknown as Record<string, number>;
      w.__pgOnceProbe = (w.__pgOnceProbe ?? 0) + n;
      return w.__pgOnceProbe;
    });
    const first = await browser.execute(script, "harness-retry-token", 5);
    const replay = await browser.execute(script, "harness-retry-token", 5);
    expect(first).toBe(5);
    expect(replay).toBe(5);
    const probe = await browser.execute(
      () => (window as unknown as Record<string, number>).__pgOnceProbe,
    );
    expect(probe).toBe(5);
  });

  it("distinct logical calls still run — tokens never collide", async () => {
    await browser.execute(() => {
      (window as unknown as Record<string, number>).__pgOnceDistinct = 0;
    });
    const bump = (n: number) => {
      const w = window as unknown as Record<string, number>;
      w.__pgOnceDistinct += n;
      return w.__pgOnceDistinct;
    };
    const a = await executeOnce(bump, 2);
    const b = await executeOnce(bump, 2);
    expect(a).toBe(2);
    expect(b).toBe(4);
  });
});
