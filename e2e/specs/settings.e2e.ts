import { browser, $, expect } from "@wdio/globals";
import {
  dirtyRepo, remoteRepo, makeDiverged, type TempRepo, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, reopenRepo, resetApp, stubNativeDialogs, confirmCallCount,
  openPalette, paletteDialog, paletteInput, switchScreen, stagedRow, changeRow,
  executeOnce, openSettings,
} from "../support/app";

async function clickPaletteRow(text: string): Promise<void> {
  const row = $(paletteDialog).$(`[data-pal-index]*=${text}`);
  await row.waitForDisplayed({
    timeout: 10_000, timeoutMsg: `palette row "${text}" never appeared`,
  });
  await row.click();
}

/**
 * Click a Settings-screen toggle row identified by its `data-setting-id`.
 *
 * Replaces a DOM-walking helper that depended on `Row`'s exact shape (`Row`
 * renders `<label-column><div/></label-column><control-column>{control}
 * </control-column>` as two side-by-side divs under one row div, and
 * `PGToggle` here is rendered without its own `label` prop — see
 * `src/features/settings/pages/remote.tsx`'s "Confirm force-push" row — so
 * there is no text node inside the actual clickable `<label>` element).
 * `SettingsRow` stamps `data-setting-id` on the row itself, which is stable
 * regardless of internal DOM shape.
 *
 * executeOnce: a driver-retry re-run would click the toggle twice, flipping
 * the setting straight back (issue #35).
 */
async function clickSettingsToggleRow(labelText: string, settingId: string): Promise<void> {
  const ok = await executeOnce((id: string) => {
    const row = document.querySelector(`[data-setting-id="${id}"]`);
    const toggle = row?.querySelector("label");
    if (!toggle) return false;
    (toggle as HTMLElement).click();
    return true;
  }, settingId);
  if (!ok) throw new Error(`settings toggle row not found: ${labelText} (${settingId})`);
}

/**
 * Measure the rendered height of one row per density mechanism.
 *
 * There is no repo truth for a layout setting, so rendered geometry IS the
 * acceptance here — and it can only be measured in a real webview: the tokens
 * are `calc(Npx + var(--row-step))`, which jsdom does not resolve (the store
 * side is unit-tested in src/features/settings/useSettingsStore.test.ts).
 *
 * Measures via `getSize("height")` on the same elements it waits for, so a
 * selector change surfaces as "row never appeared" rather than as a wrong
 * height — and reuses `changeRow()` instead of restating its selector.
 */
async function measureRows(): Promise<{
  changeRow: number;
  branchRow: number;
  commitRow: number;
  graphSvg: number;
}> {
  await switchScreen("commit");
  const change = changeRow("a.txt");
  await change.waitForDisplayed({
    timeout: 10_000, timeoutMsg: "change row never appeared for measurement",
  });
  // PGChangeRow reads --row-h, the token that already existed before density
  // was wired — this is the regression guard on the calc chain itself.
  const changeRowH = await change.getSize("height");

  await switchScreen("branches");
  const branch = $('[data-testid="branch-row"]');
  await branch.waitForDisplayed({
    timeout: 10_000, timeoutMsg: "branch row never appeared for measurement",
  });
  const branchRowH = await branch.getSize("height");

  await switchScreen("history");
  const commit = $('[data-testid="commit-row"]');
  await commit.waitForDisplayed({
    timeout: 10_000, timeoutMsg: "commit row never appeared for measurement",
  });
  const commitRowH = await commit.getSize("height");
  const graphSvgH = await commit.$("svg").getSize("height");

  return {
    changeRow: Math.round(changeRowH),
    branchRow: Math.round(branchRowH),
    commitRow: Math.round(commitRowH),
    graphSvg: Math.round(graphSvgH),
  };
}

describe("settings", () => {
  let repo: TempRepo | null = null;
  let pair: RemotePair | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose(); repo = null;
    pair?.dispose(); pair = null;
  });

  // Deterministic + offline. We do NOT click "Check for updates" — that hits
  // the live GitHub API — and the e2e build reports 0.0.0, which the backend
  // short-circuits before any network call anyway. Discovery + install logic
  // is unit-tested in src/features/update/*.test.*.
  //
  // No repo fixture: AppShell's body gate is `repo || screen === "settings"`,
  // so Settings renders standalone (this used to be its own spec file with a
  // whole app session + temp repo behind it).
  it("Updates section shows the running version and a check button", async () => {
    await openSettings("general.updates");

    const section = $('[data-testid="settings-updates"]');
    await section.waitForExist({
      timeout: 10_000, timeoutMsg: "Updates section never rendered",
    });
    await expect(section).toHaveText(expect.stringContaining("Updates"));
    await expect(section.$("div*=Current version")).toBeExisting();

    // Assert the version RESOLVED. The old `toBeExisting` on the label passed
    // even when getVersion() rejected — Settings caught it and rendered "…"
    // forever, so the check proved nothing.
    await expect(section.$("code")).toHaveText(/\d+\.\d+\.\d+/);

    await expect(section.$("button*=Check for updates")).toBeExisting();
  });

  it("pull mode persists across reload and FF-only refuses a diverged pull", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    await openSettings("git.remote");
    await $("button*=FF-only").click();
    await browser.waitUntil(
      async () => (await $('button[aria-pressed="true"]*=FF-only').isExisting()),
      { timeout: 10_000, timeoutMsg: "FF-only never became active" },
    );
    // Leave Settings before reloading. A reload now always lands on History
    // (AppShell no longer restores a screen), so this is no longer load-bearing
    // — it keeps the titlebar context normal for the steps below, as the other
    // cases in this file do.
    await switchScreen("repo");
    // Reload WITHOUT clearing localStorage (openRepo would wipe pg-settings-v2).
    await reopenRepo(pair.repo.path);
    const raw = await browser.execute(() => localStorage.getItem("pg-settings-v2"));
    expect(raw).toContain('"defaultPullMode":"FastForward"');
    await openSettings("git.remote");
    await $('button[aria-pressed="true"]*=FF-only').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "persisted FF-only not active after reload",
    });
    // Behavior: titlebar Pull consumes the persisted mode; --ff-only on a
    // diverged branch must fail and surface the error banner.
    const headBefore = pair.repo.git("rev-parse", "HEAD").trim();
    await switchScreen("repo"); // leave Settings so titlebar context is normal
    await $("button*=Pull").click();
    await $('[role="alert"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "FF-only pull on diverged branch showed no error",
    });
    expect(pair.repo.git("rev-parse", "HEAD").trim()).toBe(headBefore);
  });

  it("Merge pull mode produces a merge commit on a diverged branch", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    await openSettings("git.remote");
    await $("button*=Merge").click();
    await browser.waitUntil(
      async () => (await $('button[aria-pressed="true"]*=Merge').isExisting()),
      { timeout: 10_000, timeoutMsg: "Merge mode never became active" },
    );
    await switchScreen("repo");
    await $("button*=Pull").click();
    // repo-truth wait: merge commit (2 parents) at HEAD is the outcome.
    await browser.waitUntil(
      async () =>
        pair!.repo.git("rev-list", "--parents", "-1", "HEAD").trim().split(" ").length === 3,
      { timeout: 20_000, timeoutMsg: "no merge commit after Merge-mode pull" },
    );
    expect(pair.repo.read("remote.txt")).toBe("remote\n");
    expect(pair.repo.read("diverge.txt")).toBe("diverge\n");
  });

  it("Signed-off-by trailer is appended when the commit-panel toggle is on", async () => {
    repo = dirtyRepo(); // has staged.txt already staged
    await openRepo(repo.path);
    await switchScreen("commit");
    await stagedRow("staged.txt").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "staged file missing",
    });
    // Toggle "Add Signed-off-by trailer": PGCheckbox renders the label text
    // as a <span> inside the same native <label> that wraps the hidden
    // checkbox <input> — clicking the span triggers native label-click
    // forwarding to the input, so this works without DOM traversal (unlike
    // the Settings PGToggle rows — see clickSettingsToggleRow above).
    await $("span*=Add Signed-off-by trailer").click();
    // Type message + commit, using the exact testids from commit.e2e.ts
    // ("commit-message" — one box holds subject and body, verified in
    // src/screens/CommitPanel.tsx).
    await $('[data-testid="commit-message"]').setValue("feat: signed commit");
    await $('[data-testid="commit-button"]').click();
    await browser.waitUntil(
      async () => repo!.git("log", "-1", "--pretty=%s").trim() === "feat: signed commit",
      { timeout: 20_000, timeoutMsg: "commit never landed" },
    );
    expect(repo.git("log", "-1", "--pretty=%B")).toContain(
      "Signed-off-by: E2E Tester <e2e@platypusgit.test>",
    );
  });

  it("confirmForcePush=on + declined confirm blocks the force-push", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    const bareBefore = pair.bareGit("rev-parse", "main").trim();
    await stubNativeDialogs({ confirm: false }); // setting defaults ON
    await openPalette();
    await $(paletteInput).setValue("force"); // matches label "Force-push {branch} (with lease)"
    await clickPaletteRow("Force-push");
    // Positive signal that the gate fired: the confirm stub was called.
    await browser.waitUntil(async () => (await confirmCallCount()) > 0, {
      timeout: 10_000, timeoutMsg: "confirm gate never fired",
    });
    expect(pair.bareGit("rev-parse", "main").trim()).toBe(bareBefore);
  });

  it("confirmForcePush=on + accepted confirm force-pushes with lease", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    const localHead = pair.repo.git("rev-parse", "HEAD").trim();
    await stubNativeDialogs({ confirm: true });
    await openPalette();
    await $(paletteInput).setValue("force"); // matches label "Force-push {branch} (with lease)"
    await clickPaletteRow("Force-push");
    // repo-truth wait: bare main moving to the local head IS the outcome
    // (a plain push would be rejected on this diverged fixture, so success
    // also proves --force-with-lease was sent).
    await browser.waitUntil(
      async () => pair!.bareGit("rev-parse", "main").trim() === localHead,
      { timeout: 20_000, timeoutMsg: "force-push never landed on the bare remote" },
    );
  });

  it("UI density scales every row surface, and compact restores them", async () => {
    repo = dirtyRepo(); // a.txt unstaged, so CommitPanel has a change row
    await openRepo(repo.path);

    const compact = await measureRows();
    // Compact is the pre-density baseline — pinned so a future token edit
    // can't silently reflow the default layout.
    expect(compact).toEqual({
      changeRow: 24, branchRow: 28, commitRow: 26, graphSvg: 26,
    });

    await openSettings("general.appearance");
    await $("button*=Comfortable").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Comfortable').isExisting(),
      { timeout: 10_000, timeoutMsg: "Comfortable never became active" },
    );

    // Every surface gains exactly the one step — including the SVG graph
    // gutter, which draws in user units and would otherwise desync from the
    // commit rows it sits beside.
    expect(await measureRows()).toEqual({
      changeRow: 28, branchRow: 32, commitRow: 30, graphSvg: 30,
    });

    await openSettings("general.appearance");
    await $("button*=Compact").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Compact').isExisting(),
      { timeout: 10_000, timeoutMsg: "Compact never became active" },
    );
    expect(await measureRows()).toEqual(compact);
  });

  it("confirmForcePush=off skips the confirm entirely", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    await openSettings("git.remote");
    // Toggle "Confirm force-push" off (defaults on). See clickSettingsToggleRow
    // doc: the row label div is not inside the PGToggle's clickable <label>,
    // so this requires the data-setting-id selector rather than a text one.
    await clickSettingsToggleRow("Confirm force-push", "push.confirmForce");
    await switchScreen("repo");
    const localHead = pair.repo.git("rev-parse", "HEAD").trim();
    await stubNativeDialogs({ confirm: false }); // would block if consulted
    await openPalette();
    await $(paletteInput).setValue("force"); // matches label "Force-push {branch} (with lease)"
    await clickPaletteRow("Force-push");
    await browser.waitUntil(
      async () => pair!.bareGit("rev-parse", "main").trim() === localHead,
      { timeout: 20_000, timeoutMsg: "ungated force-push never landed" },
    );
    expect(await confirmCallCount()).toBe(0);
  });

  // Navigation + search in the real webview. The unit tests cover matching and
  // filtering; what only a real run proves is that the side menu switches the
  // rendered page and that a search reaches rows on pages nobody navigated to.
  it("navigates to a page and searches across pages", async () => {
    await openSettings("git.diff");
    await expect($('[data-setting-id="diff.layout"]')).toBeExisting();
    // A page the user did not navigate to is genuinely not rendered.
    await expect($('[data-setting-id="appearance.zoom"]')).not.toBeExisting();

    await $('[data-testid="settings-search"]').setValue("theme");
    // Appearance rows appear without navigating to Appearance…
    await $('[data-setting-id="appearance.theme"]').waitForExist({
      timeout: 10_000,
      timeoutMsg: "search never surfaced the Appearance theme row",
    });
    // …and a non-matching row on the page we WERE on is filtered out.
    await expect($('[data-setting-id="diff.context"]')).not.toBeExisting();
  });
});
