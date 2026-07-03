import { browser, $, expect } from "@wdio/globals";
import {
  dirtyRepo, remoteRepo, makeDiverged, type TempRepo, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, reopenRepo, resetApp, stubNativeDialogs, confirmCallCount,
  openPalette, paletteDialog, paletteInput, switchScreen, stagedRow,
} from "../support/app";

/** Open the Settings screen via the titlebar gear. */
async function openSettings(): Promise<void> {
  await $('button[title="Settings"]').click();
  await $("div*=Default pull mode").waitForDisplayed({
    timeout: 10_000, timeoutMsg: "Settings screen never appeared",
  });
}

async function clickPaletteRow(text: string): Promise<void> {
  const row = $(paletteDialog).$(`[data-pal-index]*=${text}`);
  await row.waitForDisplayed({
    timeout: 10_000, timeoutMsg: `palette row "${text}" never appeared`,
  });
  await row.click();
}

/**
 * Click a Settings-screen toggle row identified by its label text.
 *
 * DOM deviation from the task brief: `Row`'s label renders in a `<div>` (not
 * a `<span>`), and — critically — that div lives in a *sibling* column from
 * the `PGToggle` control (`Row` renders `<label-column><div/></label-column>
 * <control-column>{control}</control-column>` as two side-by-side divs under
 * one row div). `PGToggle` here is rendered without its own `label` prop
 * (see `src/screens/Settings.tsx`'s "Confirm force-push" row), so there is no
 * text node inside the actual clickable `<label>` element — clicking the
 * row's label text does nothing. Verified via
 * `browser.execute(() => ...outerHTML)` against the real DOM. Contrast with
 * the CommitPanel signoff checkbox below, where `PGCheckbox` DOES render its
 * `label` text as a `<span>` child of the same native `<label>` that wraps
 * the hidden `<input type="checkbox">` — native label-click-forwarding makes
 * `span*=...` work there without this helper.
 */
async function clickSettingsToggleRow(labelText: string): Promise<void> {
  const ok = await browser.execute((text: string) => {
    const divs = Array.from(document.querySelectorAll("div"));
    const labelDiv = divs.find(
      (d) => d.children.length === 0 && d.textContent?.trim() === text,
    );
    if (!labelDiv) return false;
    // labelDiv -> (label+hint column) -> (row div, sibling holds control column)
    const row = labelDiv.parentElement?.parentElement;
    const toggle = row?.querySelector("label");
    if (!toggle) return false;
    (toggle as HTMLElement).click();
    return true;
  }, labelText);
  if (!ok) throw new Error(`settings toggle row not found: ${labelText}`);
}

describe("settings", () => {
  let repo: TempRepo | null = null;
  let pair: RemotePair | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose(); repo = null;
    pair?.dispose(); pair = null;
  });

  it("pull mode persists across reload and FF-only refuses a diverged pull", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    await openSettings();
    await $("button*=FF-only").click();
    await browser.waitUntil(
      async () => (await $('button[aria-pressed="true"]*=FF-only').isExisting()),
      { timeout: 10_000, timeoutMsg: "FF-only never became active" },
    );
    // Leave Settings BEFORE reloading. AppShell's gate is
    // `repo || screen === "settings"` (src/AppShell.tsx) and the screen id
    // persists to localStorage["pg-screen"] outside pg-settings-v2 entirely.
    // A reload with pg-screen still "settings" renders SettingsScreen
    // directly on the freshly-booted (repo-less) store, bypassing
    // WelcomeScreen's recent-repo list altogether — reopenRepo's row-click
    // would then have nothing to find. Verified via
    // `browser.execute(() => document.body.innerHTML)`: without this step
    // the reload lands back on Settings with an empty recents DOM query.
    await switchScreen("repo");
    // Reload WITHOUT clearing localStorage (openRepo would wipe pg-settings-v2).
    await reopenRepo(pair.repo.path);
    const raw = await browser.execute(() => localStorage.getItem("pg-settings-v2"));
    expect(raw).toContain('"defaultPullMode":"FastForward"');
    await openSettings();
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
    await openSettings();
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
    // (the brief's "commit-message" was a guess; the real attribute is
    // "commit-subject" — verified in src/screens/CommitPanel.tsx).
    await $('[data-testid="commit-subject"]').setValue("feat: signed commit");
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

  it("confirmForcePush=off skips the confirm entirely", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    await openSettings();
    // Toggle "Confirm force-push" off (defaults on). See clickSettingsToggleRow
    // doc: the row label div is not inside the PGToggle's clickable <label>,
    // so this requires the DOM-traversal helper rather than a text selector.
    await clickSettingsToggleRow("Confirm force-push");
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
});
