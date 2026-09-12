import { browser, $, expect } from "@wdio/globals";
import {
  dirtyRepo, remoteRepo, makeDiverged, type TempRepo, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, reopenRepo, resetApp, stubNativeDialogs, confirmCallCount,
  openPalette, paletteDialog, paletteInput, switchScreen, stagedRow, changeRow,
  executeOnce, openSettings, jsKey,
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
 * Measure the rendered height of one row per row-geometry mechanism.
 *
 * There is no repo truth for a layout setting, so rendered geometry IS the
 * acceptance here — and it can only be measured in a real webview: the tokens
 * are `calc(Npx * var(--row-scale) + var(--row-step))`, which jsdom does not
 * resolve (the store side is unit-tested in
 * src/features/settings/useSettingsStore.test.ts).
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

  it("Spacing scales every row surface, and compact restores them", async () => {
    repo = dirtyRepo(); // a.txt unstaged, so CommitPanel has a change row
    await openRepo(repo.path);

    // The app's OWN default is "cozy" (Task 1's compact -> cozy migration),
    // not "compact" — so the zero-step baseline has to be SELECTED, not read
    // off a freshly opened repo, or this measures cozy's +2 instead of 0.
    await openSettings("general.appearance");
    await $("button*=Compact").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Compact').isExisting(),
      { timeout: 10_000, timeoutMsg: "Compact never became active" },
    );

    const compact = await measureRows();
    // Compact is the pre-spacing baseline — pinned so a future token edit
    // can't silently reflow the zero-step layout.
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

  /**
   * The Settings panel's OWN rows resolve the spacing calc.
   *
   * `measureRows` above covers the four surfaces outside Settings. These two
   * are the ones no unit test can reach: jsdom does not resolve `calc()`, so
   * `SettingsCard.test.tsx` can only assert the token STRING — which stays
   * green if the `/ 2` is dropped and a row grows 8px instead of 4.
   *
   * Asserted as a DELTA, not as pinned absolutes like the test above, because
   * both heights depend on how their hint prose wraps at the container's width
   * — a copy edit would redden a pinned number while the geometry is correct.
   * The delta is the actual invariant: exactly one step, no double-count.
   *
   * `theme-actions` is the strip between two `SettingsRow`s in the same card.
   * It is here because a fixed height there gives ONE card two row pitches,
   * which is the same bug as a forge row that does not scale.
   */
  it("Settings rows resolve the spacing calc, by exactly one step", async () => {
    const STEP = 4; // SPACING_STEP_PX.comfortable

    const measureSettings = async () => {
      const row = $('[data-setting-id="appearance.spacing"]');
      await row.waitForDisplayed({
        timeout: 10_000, timeoutMsg: "spacing row never appeared for measurement",
      });
      const strip = $('[data-testid="theme-actions"]');
      await strip.waitForDisplayed({
        timeout: 10_000, timeoutMsg: "theme action strip never appeared for measurement",
      });
      return {
        row: Math.round((await row.getSize("height")) as number),
        strip: Math.round((await strip.getSize("height")) as number),
      };
    };

    await openSettings("general.appearance");
    // The app's own default is "cozy", not "compact" (Task 1's migration) —
    // select Compact explicitly so the delta below is measured from a true
    // zero step, not from cozy's already-nonzero one.
    await $("button*=Compact").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Compact').isExisting(),
      { timeout: 10_000, timeoutMsg: "Compact never became active" },
    );
    const compact = await measureSettings();

    await $("button*=Comfortable").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Comfortable').isExisting(),
      { timeout: 10_000, timeoutMsg: "Comfortable never became active" },
    );
    const comfortable = await measureSettings();

    // Exactly one step each. `+ var(--row-step)` without the `/ 2` would
    // report 2 × STEP here, and `calc` resolving to nothing would report 0.
    expect(comfortable.row - compact.row).toBe(STEP);
    expect(comfortable.strip - compact.strip).toBe(STEP);

    await $("button*=Compact").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Compact').isExisting(),
      { timeout: 10_000, timeoutMsg: "Compact never became active" },
    );
    expect(await measureSettings()).toEqual(compact);
  });

  /**
   * Text size is the axis no unit test can measure end to end: jsdom does not
   * resolve `calc()`, so the store side only proves the token STRING is
   * written (`useSettingsStore.test.ts`), never that a row grown from it
   * actually clears the bigger type sitting inside it. A real webview is the
   * only place the scaled `--fs-13` ramp and the scaled row box are
   * observable together — reuses `measureRows()` rather than restating its
   * screen-switching, exactly as the spacing case above does.
   */
  it("Text size scales the type and the rows that hold it", async () => {
    repo = dirtyRepo(); // a.txt unstaged, so CommitPanel has a change row
    await openRepo(repo.path);

    const before = await measureRows();
    const fsBefore = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
    );
    expect(fsBefore).toBe("13px");

    await openSettings("general.appearance");
    await $("button*=Larger").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Larger').isExisting(),
      { timeout: 10_000, timeoutMsg: "Larger never became active" },
    );

    const fsAfter = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
    );
    expect(fsAfter).toBe("16.9px");

    // The row has to grow with the type or it clips it — this is the whole
    // point of --row-scale, and jsdom cannot see it.
    const after = await measureRows();
    expect(after.commitRow).toBeGreaterThan(before.commitRow);
    expect(after.graphSvg).toBeGreaterThan(before.graphSvg);
    expect(after.changeRow).toBeGreaterThan(before.changeRow);
    expect(after.branchRow).toBeGreaterThan(before.branchRow);

    await openSettings("general.appearance");
    await $("button*=Default").click();
    await browser.waitUntil(
      async () => $('button[aria-pressed="true"]*=Default').isExisting(),
      { timeout: 10_000, timeoutMsg: "Default never became active" },
    );
    const fsRestored = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--fs-13").trim(),
    );
    expect(fsRestored).toBe("13px");
    expect(await measureRows()).toEqual(before);
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

  /**
   * Creating a custom theme, end to end, in the real webview (#435 revamp).
   *
   * What only a real run proves: the gallery renders a card per theme in the
   * real engine, Duplicate opens the editor seeded from that card, the live
   * preview and the app repaint from one `themeVars` map, and the saved theme
   * survives as the active one.
   *
   * **Export and import are deliberately NOT here.** They open a NATIVE save
   * or open dialog, which WebDriver cannot drive at all — so a green e2e suite
   * is not evidence that #435 is fixed. That evidence is
   * `src-tauri/tests/user_file.rs` plus the `saveTextFile` component tests,
   * and `test/fileSave.test.ts` for the pattern never coming back.
   */
  it("duplicates a built-in theme into a custom one and keeps it", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await openSettings("general.appearance");

    // The gallery, not a dropdown of names: one card per theme, each a real
    // preview painted in its own colours.
    const nordCard = $('[role="radio"][aria-label="Nord"]');
    await nordCard.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "theme gallery never rendered the Nord card",
    });

    await $('button[aria-label="Duplicate Nord"]').click();

    // The editor is a PGModal reading useThemeEditorStore, so its own name
    // field is the signal that the draft opened — not the dialog wrapper,
    // which several other overlays also produce.
    const nameField = $('[data-testid="theme-editor-name"]');
    await nameField.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "theme editor never opened from Duplicate",
    });
    await nameField.setValue("E2E Theme");

    // The preview paints from the DRAFT, in its own subtree — the property
    // that makes a card able to show a theme other than the active one.
    const previewAccent = await browser.execute(() => {
      const el = document.querySelector("[data-testid='theme-preview']");
      return el ? (el as HTMLElement).style.getPropertyValue("--accent") : null;
    });
    expect(previewAccent).toBeTruthy();

    await $('[data-testid="theme-editor-save"]').click();

    // Acceptance: the new theme is what the app is wearing, and the gallery
    // says so on its own card. `data-theme` is what `applyTheme` stamps, so a
    // draft id here would mean the save never went through the store.
    const savedCard = $('[role="radio"][aria-label="E2E Theme"]');
    await savedCard.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the saved theme never appeared as a gallery card",
    });
    await browser.waitUntil(
      async () => (await savedCard.getAttribute("aria-checked")) === "true",
      { timeout: 10_000, timeoutMsg: "the saved theme never became the active card" },
    );
    const themeId = await browser.execute(() => document.documentElement.dataset.theme);
    expect(themeId).not.toBe("__draft__");
    expect(themeId).toMatch(/^custom-/);
  });

  /**
   * The colour picker, on the real engine.
   *
   * Worth a case for the same reason the export ones below are: what it
   * replaced was `<input type="color">`, a hand-off to a host dialog, and a
   * native control of that class is silently inert on WebKitGTK (#435). No
   * component test can tell the difference — jsdom renders no dialog either
   * way — so "the picker opens and changes a colour here" is a claim only this
   * layer can make.
   *
   * Two of the three assertions are engine-specific on purpose. The wheel is
   * an ImageData written per pixel and blitted with `putImageData`, and the
   * unit suite paints it into a STUB context that records nothing, so whether
   * WebKitGTK 605 produces actual pixels is untested until here. And Escape's
   * ordering — the picker claims the chord, the dialog behind it survives — is
   * a real capture-phase dispatcher racing a real portal.
   */
  it("picks a colour with the wheel instead of the host's colour dialog", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await openSettings("general.appearance");

    const nordCard = $('[role="radio"][aria-label="Nord"]');
    await nordCard.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "theme gallery never rendered the Nord card",
    });
    await $('button[aria-label="Duplicate Nord"]').click();
    await $('[data-testid="theme-editor-name"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "theme editor never opened from Duplicate",
    });

    // No native colour input anywhere in the editor — `test/nativeColorInput.
    // test.ts` guards the source, this checks what the webview actually built.
    expect(
      await browser.execute(() => !!document.querySelector('input[type="color"]')),
    ).toBe(false);

    // The guided start's Accent swatch. The eighteen slot rows carry one too,
    // including their own "Accent", but they live behind the collapsed
    // disclosure — so while it is shut this selector is unambiguous.
    await $('button[aria-label^="Accent — "]').click();
    const picker = $("[data-pg-colorpicker]");
    await picker.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the colour picker popover never opened",
    });

    // The wheel really painted. A stubbed 2D context (what the unit suite
    // hands the painter) would leave this all-zero, and so would a WebKitGTK
    // without `createImageData` — which is the failure mode that has to be
    // caught on the engine rather than in jsdom.
    const wheel = await browser.execute(() => {
      const canvas = document.querySelector(
        "[data-pg-colorpicker] canvas",
      ) as HTMLCanvasElement | null;
      if (!canvas || !canvas.width) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // Dead centre is zero saturation at full value: white, opaque.
      const px = ctx.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data;
      return { r: px[0], g: px[1], b: px[2], a: px[3] };
    });
    expect(wheel).not.toBeNull();
    expect(wheel!.a).toBeGreaterThan(0);
    expect(wheel!.r).toBeGreaterThan(200);
    expect(wheel!.g).toBeGreaterThan(200);
    expect(wheel!.b).toBeGreaterThan(200);

    const accentOf = () =>
      browser.execute(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      );
    const before = await accentOf();
    expect(before).toBeTruthy();

    // The keyboard equivalent of dragging the wheel, which is also the only
    // half of it WebDriver can reach — a synthetic pointer drag would stand in
    // for a gesture nobody makes.
    const hue = '[role="slider"][aria-label="HSV hue"]';
    await $(hue).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the picker never rendered its hue slider",
    });
    for (let i = 0; i < 20; i++) await jsKey(hue, "ArrowRight");

    // Live-applied to the real document, which is what makes the app repaint
    // behind the dialog while a colour is being chosen.
    await browser.waitUntil(async () => (await accentOf()) !== before, {
      timeout: 10_000,
      timeoutMsg: "moving the hue slider never repainted --accent",
    });

    // Escape belongs to the picker while it is open: the popover goes, the
    // theme editor stays. Registered-always-declining-while-closed is what
    // makes both halves true, and only a real dispatcher proves the ordering.
    await jsKey("[data-pg-colorpicker]", "Escape");
    await picker.waitForExist({
      reverse: true,
      timeout: 10_000,
      timeoutMsg: "Escape did not close the colour picker",
    });
    expect(await $('[data-testid="theme-editor-name"]').isExisting()).toBe(true);

    // And a dismissal is not an answer — the colour goes back.
    await browser.waitUntil(async () => (await accentOf()) === before, {
      timeout: 10_000,
      timeoutMsg: "Escape closed the picker without restoring the colour",
    });
  });

  /**
   * The file commands behind every export, over REAL IPC on real WebKitGTK.
   *
   * This is the closest thing to evidence for #435 that an automated test can
   * produce. What it does NOT cover is the native save dialog: WebDriver
   * cannot drive an OS modal, so `saveTextFile`'s first half is out of reach
   * here and is covered by component tests against the mocked plugin.
   *
   * What it DOES cover is everything the old implementation got wrong, on the
   * platform that reported it: the commands are registered under the names the
   * frontend calls, their argument names match, `dialog`/fs access is actually
   * permitted by `capabilities/default.json`, and a write really lands on a
   * Linux filesystem and reads back byte-for-byte. The old code never reached
   * a command at all — it handed the file to an `<a download>` that WebKitGTK
   * silently ignores.
   *
   * executeOnce: a driver-retry re-run would re-issue the write.
   */
  it("writes and reads a real file through the export commands", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);

    const path = `/tmp/pg-e2e-theme-${Date.now()}.pgtheme.json`;
    const body = JSON.stringify(
      { $schema: "https://platypusgit.dev/theme.schema.json", version: 1, name: "IPC" },
      null,
      2,
    );

    const wrote = await executeOnce(
      async (p: string, contents: string) => {
        const core = (window as unknown as {
          __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
        }).__TAURI__?.core;
        if (!core) return "no bridge";
        try {
          await core.invoke("write_user_file", { path: p, contents });
          return "ok";
        } catch (e) {
          return `write failed: ${String(e)}`;
        }
      },
      path,
      body,
    );
    expect(wrote).toBe("ok");

    const readBack = await browser.execute(async (p: string) => {
      const core = (window as unknown as {
        __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
      }).__TAURI__?.core;
      try {
        return (await core!.invoke("read_user_file", { path: p })) as string;
      } catch (e) {
        return `read failed: ${String(e)}`;
      }
    }, path);
    expect(readBack).toBe(body);

    // A folder is a refusal, not a surprise — the cap and the type checks are
    // the reason a mis-picked path cannot become a gigabyte-sized IPC message.
    const folder = await browser.execute(async () => {
      const core = (window as unknown as {
        __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
      }).__TAURI__?.core;
      try {
        await core!.invoke("read_user_file", { path: "/tmp" });
        return "unexpectedly succeeded";
      } catch (e) {
        return JSON.stringify(e);
      }
    });
    expect(folder).toContain("InvalidPath");
  });

  /**
   * The report dialog against the real webview.
   *
   * What only a real run proves: the diagnostics commands actually answer on
   * a real build (`diagnostics_report` resolves the per-platform log dir, and
   * `read_log_tail` reads a file that the LOGGER, not the test, created), and
   * the preview therefore renders something rather than sitting on "Reading
   * diagnostics…" forever. The unit tests mock both.
   *
   * It deliberately stops before `report-open`: that hands a URL to the OS
   * browser, which under xvfb means either a hung `xdg-open` or a browser
   * nobody closes. Copy-and-open is covered by the component test.
   */
  it("assembles a bug report from the real diagnostics", async () => {
    await openSettings("advanced.backup");
    await $('[data-testid="settings-report-issue"]').click();

    const preview = $('[data-testid="report-preview"]');
    await preview.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "report dialog never rendered a preview",
    });
    // The version line is the one part no opt-out removes, so it is the
    // signal that the report was ASSEMBLED rather than merely mounted —
    // "Reading diagnostics…" is what an unresolved `diagnostics_report`
    // leaves on screen, and it satisfies "displayed" just as well.
    await browser.waitUntil(
      async () => (await preview.getText()).includes("platypusgit "),
      {
        timeout: 10_000,
        timeoutMsg: "preview never carried the version line",
      },
    );
    const text = await preview.getText();
    // The startup environment line, written by the real backend.
    expect(text).toContain("host os=");
    expect(text).toContain("arch=");

    // The log tail is present, and it is the real file: the logger's own
    // startup lines are in it, which no mock produces.
    expect(text).toContain("── log tail ──");
    expect(text).toContain("platypusgit.log");

    /*
     * Now both opt-outs, and the ORDER matters for a reason worth writing
     * down: the log tail CONTAINS the environment line. `environment_line`
     * writes `host os=… arch=… git=…` into the log at startup — that is the
     * whole reason `read_log_tail` and the report header coexist (#274) — so
     * "the environment is excluded" cannot be checked by the absence of
     * `host os=` while the log is still included. Measured: unchecking the
     * environment took the preview from 2762 to 2700 characters and left a
     * `host os=` line from the log behind.
     *
     * So the log comes off first, and only then is `host os=` a signal.
     */
    await $('[data-testid="report-include-log"]').click();
    await browser.waitUntil(
      async () => !(await preview.getText()).includes("── log tail ──"),
      {
        timeout: 10_000,
        timeoutMsg: "unchecking the log never removed it from the preview",
      },
    );
    // The path goes with it — that is what makes this the privacy control.
    expect(await preview.getText()).not.toContain("platypusgit.log");

    await $('[data-testid="report-include-env"]').click();
    await browser.waitUntil(
      async () => !(await preview.getText()).includes("host os="),
      {
        timeout: 10_000,
        timeoutMsg: "unchecking the environment never removed it",
      },
    );
    // Down to the one line no opt-out removes.
    expect(await preview.getText()).toContain("platypusgit ");

    await $('[data-testid="report-cancel"]').click();
    await $('[data-testid="report-dialog"]').waitForExist({
      reverse: true,
      timeout: 10_000,
      timeoutMsg: "report dialog never closed",
    });
  });
});
