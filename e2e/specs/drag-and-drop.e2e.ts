import { $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  changeRow,
  executeOnce,
  jsChord,
  jsDrag,
  openRepo,
  resetApp,
  stagedRow,
  switchScreen,
} from "../support/app";

// Drag-and-drop staging (#91), in the real webview: a pointer drag between the
// CHANGES and STAGED sections must reach the same index the checkbox does.
//
// Only the staging surface is e2e'd. The graph gestures (merge / rebase /
// cherry-pick on a ref or commit drop) are a pure resolution table under unit
// test plus a `pgConfirm` round-trip covered by History.dnd.test.tsx; driving
// them here would need a diverged fixture for one extra assertion. The
// rebase-plan reorder is covered by Rebase.reorder.test.tsx, and its
// preserve-mode gate is asserted in rebase.e2e.ts where a merge range already
// exists.

/** The CHANGES drop zone is the section wrapper the drag primitive registered. */
const changesZone = '[data-testid="changes-list"] [data-pg-drop-id]';
const stagedZone = '[data-testid="staged-list"]';

/**
 * Half of `jsDrag`: grab and hover, but never release — so the mid-gesture
 * affordance can be asserted across driver commands. Local to this spec because
 * holding a drag open is only ever useful here.
 */
function dragHold(fromSel: string, toSel: string): Promise<boolean> {
  // executeOnce like every other side-effectful in-page script: a driver retry
  // must not re-arm a gesture that is already in flight.
  return executeOnce(
    (from: string, to: string) => {
      const src = document.querySelector(from) as HTMLElement | null;
      const dst = document.querySelector(to) as HTMLElement | null;
      if (!src || !dst) return false;
      const centre = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const a = centre(src);
      const b = centre(dst);
      const Ctor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      const fire = (el: HTMLElement, type: string, p: { x: number; y: number }) =>
        el.dispatchEvent(
          new Ctor(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: p.x,
            clientY: p.y,
          } as PointerEventInit),
        );
      fire(src, "pointerdown", a);
      // Halfway first: clears the 4px slop, exactly as a hardware drag does.
      fire(dst, "pointermove", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      fire(dst, "pointermove", b);
      return true;
    },
    fromSel,
    toSel,
  );
}

describe("drag and drop", () => {
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

  it("stages a file dragged from CHANGES onto STAGED", async () => {
    await jsDrag('[data-testid="changes-list"] [data-path="a.txt"]', stagedZone);

    await stagedRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "a.txt never moved to the staged list after the drag",
    });
    await expect(changeRow("a.txt")).not.toBeExisting();

    // repo truth: the index now carries a.txt.
    expect(repo.git("diff", "--cached", "--name-only").split("\n")).toContain(
      "a.txt",
    );
  });

  it("unstages a file dragged from STAGED onto CHANGES", async () => {
    await stagedRow("staged.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "staged.txt never appeared in the staged list",
    });

    await jsDrag(
      '[data-testid="staged-list"] [data-path="staged.txt"]',
      changesZone,
    );

    await changeRow("staged.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "staged.txt never moved back to the changes list after the drag",
    });
    await expect(stagedRow("staged.txt")).not.toBeExisting();

    expect(repo.git("diff", "--cached", "--name-only").split("\n")).not.toContain(
      "staged.txt",
    );
  });

  // The accident every list-to-list drag has. It must cost nothing: the row
  // stays where it was and the index is untouched.
  it("leaves a row alone when it is dropped back on its own section", async () => {
    const before = repo.git("diff", "--cached", "--name-only");

    await jsDrag('[data-testid="changes-list"] [data-path="a.txt"]', changesZone);

    await expect(changeRow("a.txt")).toBeDisplayed();
    await expect(stagedRow("a.txt")).not.toBeExisting();
    expect(repo.git("diff", "--cached", "--name-only")).toBe(before);
  });

  it("marks the hovered zone, says what the drop will do, and cancels on Escape", async () => {
    const armed = await dragHold(
      '[data-testid="changes-list"] [data-path="a.txt"]',
      stagedZone,
    );
    expect(armed).toBe(true);

    await $('[data-testid="drop-hint"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the hovered staging zone never showed its drop hint",
    });
    await expect($('[data-testid="drop-hint"]')).toHaveText("Drop to stage");
    await expect($('[data-testid="drag-ghost"]')).toBeExisting();
    await expect($(`${stagedZone}[data-pg-drop-over]`)).toBeExisting();

    // Escape cancels: the ghost goes, and nothing was staged.
    await jsChord("Escape");
    await $('[data-testid="drag-ghost"]').waitForExist({
      reverse: true,
      timeout: 10_000,
      timeoutMsg: "the drag ghost survived Escape",
    });
    await expect(changeRow("a.txt")).toBeDisplayed();
    expect(repo.git("diff", "--cached", "--name-only").split("\n")).not.toContain(
      "a.txt",
    );
  });
});
