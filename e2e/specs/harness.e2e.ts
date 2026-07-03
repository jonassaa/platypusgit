import { browser, expect } from "@wdio/globals";
import { buildExecuteOnceScript, executeOnce } from "../support/app";

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
