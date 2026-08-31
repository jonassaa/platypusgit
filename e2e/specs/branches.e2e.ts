import { browser, $, $$, expect } from "@wdio/globals";
import { basicRepo, manyRefsRepo, TempRepo } from "../support/tempRepo";
import {
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  switchScreen,
} from "../support/app";

describe("branches", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = basicRepo();
    await openRepo(repo.path);
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("creates a branch via picker, chip updates, checkout back works", async () => {
    const chip = $('[data-testid="branch-chip"]');

    // create + switch
    await chip.click();
    const search = $('input[placeholder="Switch to branch…"]');
    await search.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "branch search input never appeared",
    });
    await search.setValue("e2e-branch");
    const createSpan = $('[data-testid="branch-create"]');
    await createSpan.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "create-branch affordance never appeared",
    });
    await createSpan.click();
    await browser.waitUntil(
      async () => (await chip.getText()).includes("e2e-branch"),
      { timeout: 20_000, timeoutMsg: "chip did not update to new branch" },
    );
    expect(repo.git("branch", "--show-current").trim()).toBe("e2e-branch");

    // checkout main again via picker row
    // `data-branch-row` is a bare boolean attribute (no `${kind}:${name}`
    // value), so select the row by scoped text match instead of an exact
    // attribute-value selector.
    await chip.click();
    const mainRow = $('[data-branch-row]*=main');
    await mainRow.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "main branch row never appeared in picker",
    });
    await mainRow.click();
    await browser.waitUntil(
      async () => (await chip.getText()).includes("main"),
      { timeout: 20_000, timeoutMsg: "chip did not update back to main" },
    );
    expect(repo.git("branch", "--show-current").trim()).toBe("main");
  });
  // #238: a user pin outranks the recency order AND is hoisted out of its
  // folder, so it is the first row on the Branches screen even when the folder
  // it belongs to is collapsed.
  it("pins a branch to the top of the Branches screen", async () => {
    repo.git("branch", "feat/alpha");
    repo.git("branch", "feat/beta");
    await openRepo(repo.path);
    await switchScreen("branches");

    await browser.waitUntil(
      async () => [...(await $$('[data-testid="branch-row"]'))].length > 1,
      { timeout: 20_000, timeoutMsg: "branch rows never appeared" },
    );

    const labels = () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll('[data-testid="branch-row"]')).map(
          (r) => r.querySelector("[data-branch-label]")?.textContent ?? "",
        ),
      );

    // `feat/beta` sits inside the `feat` folder, labelled by its segment.
    expect(await labels()).not.toContain("feat/beta");

    await jsContextMenu('[data-testid="branch-row"]', { text: "beta" });
    await jsClickMenuItem("Pin to top");

    await browser.waitUntil(async () => (await labels())[0] === "feat/beta", {
      timeout: 20_000,
      timeoutMsg: "the pinned branch never reached the top row",
    });

    // Hoisted under its FULL name, and exactly once — not duplicated into the
    // folder it came from.
    const rows = await labels();
    expect(rows.filter((l) => l === "feat/beta")).toHaveLength(1);

    // Persisted per repository, so a reload keeps it on top.
    const stored = await browser.execute(() =>
      localStorage.getItem("pg-branch-pins-v1"),
    );
    expect(stored).toContain("feat/beta");
  });
});

describe("branches — many refs layout", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = manyRefsRepo();
    await openRepo(repo.path);
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("scrolls the refs list internally instead of overflowing the viewport", async () => {
    await switchScreen("branches");

    const list = $('[aria-label="Refs list"]');
    await list.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "refs list scroll region never appeared",
    });

    // Gate: wait until the store's branch/tag fetch has populated enough rows
    // to overflow the content area (fetch resolves after the screen mounts).
    // scrollHeight is the total row height in both broken and fixed layouts,
    // so this only proves the rows rendered — not that scrolling works.
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const el = document.querySelector('[aria-label="Refs list"]');
          return !!el && el.scrollHeight > 1500;
        }),
      {
        timeout: 20_000,
        timeoutMsg: "refs list never grew tall enough to overflow",
      },
    );

    const geom = await browser.execute(() => {
      const el = document.querySelector(
        '[aria-label="Refs list"]',
      ) as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        bottom: r.bottom,
        innerHeight: window.innerHeight,
      };
    });

    // The content overflows the scroll region internally — a real scrollbar,
    // not the list stretching to full content height. Broken layout has
    // clientHeight === scrollHeight (nothing to scroll).
    expect(geom.scrollHeight).toBeGreaterThan(geom.clientHeight);

    // The scroll region is bounded to the window: its bottom edge stays within
    // the viewport rather than spilling past it (what pushed the toolbar and
    // status bar off-screen before the fix).
    expect(geom.bottom).toBeLessThanOrEqual(geom.innerHeight + 2);

    // Toolbar survives — filter input still visible at the top.
    await expect($('input[placeholder="Filter by name…"]')).toBeDisplayed();
  });

  // #135: the default branch pins to the top of the picker. This fixture is the
  // sharpest case for it — all 61 branches were cut from one commit, so they
  // tie on tip time and fall back to name order, which puts `feature/branch-00`
  // first and `main` sixty rows below the fold.
  it("pins the default branch to the top of the branch picker", async () => {
    const chip = $('[data-testid="branch-chip"]');
    await chip.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "branch chip never appeared",
    });
    await chip.click();

    await $('input[placeholder="Switch to branch…"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "branch search input never appeared",
    });

    // The store's branch fetch resolves after the popover mounts; wait for the
    // full set rather than asserting against a partial list.
    await browser.waitUntil(
      async () => [...(await $$("[data-branch-row]"))].length > 60,
      {
        timeout: 20_000,
        timeoutMsg: "picker never listed every branch",
      },
    );

    // Read the name span directly: the row also renders a `HEAD` badge, and
    // getText() joins the two differently across webviews.
    const firstRow = await browser.execute(
      () =>
        document.querySelector("[data-branch-row]")?.querySelector("span")
          ?.textContent ?? null,
    );

    expect(firstRow).toBe("main");
  });
});
