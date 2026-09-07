// The built-in terminal (#243).
//
// Deliberately small. Everything about the session registry is cheaper and
// sharper in `src-tauri/tests/terminal.rs`, and everything about the wiring is
// cheaper in vitest. What ONLY a real webview can answer is whether a pty's
// bytes reach xterm and render — the whole chain, pty → base64 → IPC → decode →
// renderer — and whether the panel docks without breaking the shell layout.
//
// The assertions read xterm's own rows for that reason: anything closer to the
// backend would still pass with the renderer broken, which is the one failure
// this file exists to catch.
import { $, browser, expect } from "@wdio/globals";

import { basicRepo, TempRepo } from "../support/tempRepo";
import {
  TERMINAL_VIEW,
  jsChord,
  jsKey,
  jsTypeInTerminal,
  openPalette,
  openRepo,
  paletteDialog,
  paletteInput,
  resetApp,
  terminalText,
} from "../support/app";

describe("the built-in terminal", () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = undefined;
  });

  it("opens a shell in the repository, renders its output, and hides again", async () => {
    repo = basicRepo();
    await openRepo(repo.path);

    // Closed by default — a terminal nobody asked for should not have spawned
    // a shell just because a repository opened.
    await expect($(TERMINAL_VIEW)).not.toBeExisting();

    await jsChord("Ctrl+`");
    await $(TERMINAL_VIEW).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the terminal panel never appeared after Ctrl+`",
    });

    // A prompt means the pty started, the shell ran its rc files, and its bytes
    // made it all the way to the renderer. This is the assertion the Rust and
    // vitest layers cannot make.
    await browser.waitUntil(async () => (await terminalText()).trim().length > 0,
      {
        timeout: 30_000,
        timeoutMsg: "the terminal rendered nothing — no prompt reached xterm",
      },
    );

    // A marker unique per run, so a stale snapshot cannot produce a false pass.
    const marker = `pgit-e2e-${Date.now()}`;
    await jsTypeInTerminal(`echo ${marker}\n`);

    await browser.waitUntil(
      async () => {
        const text = await terminalText();
        // Twice: once as the echo of what was typed, once as the output. One
        // occurrence is just the echo and proves nothing ran.
        return text.split(marker).length - 1 >= 2;
      },
      {
        timeout: 30_000,
        timeoutMsg: `the shell never produced "${marker}" — the command did not run, or its output did not render`,
      },
    );

    // And the way back out. The view stays in the DOM on purpose — hiding is
    // not unmounting, or the scrollback would go with it — so this asserts on
    // VISIBILITY, and the panel is what carries it.
    await jsChord("Ctrl+`");
    await $('[data-testid="terminal-panel"]').waitForDisplayed({
      reverse: true,
      timeout: 10_000,
      timeoutMsg: "the terminal panel did not hide on the second Ctrl+`",
    });

    // Reopening returns to the SAME terminal, marker and all: the shell was
    // never killed and neither was its scrollback.
    await jsChord("Ctrl+`");
    await $(TERMINAL_VIEW).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the terminal panel did not come back",
    });
    await expect(await terminalText()).toContain(marker);
  });

  // The palette route, and it is here rather than in `palette.e2e.ts` because
  // only a real webview can answer it: the row is built from `buildCommands()`,
  // and vitest asserting on that ARRAY is exactly the shape of test that passed
  // for months while `terminal.toggle` had a chord, a cheat-sheet entry and no
  // palette row at all. "Row never appeared" is an e2e-only finding here — it
  // was for "New window" (#256).
  it("opens from the command palette, and the row then offers the way back", async () => {
    repo = basicRepo();
    await openRepo(repo.path);

    await openPalette();
    await $(paletteInput).setValue("terminal");
    const show = $(paletteDialog).$("[data-pal-index]*=Show terminal");
    await show.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: 'palette row "Show terminal" never appeared',
    });
    await show.click();

    await $(TERMINAL_VIEW).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the terminal panel never appeared after the palette row",
    });

    // The label is state, not a fixed string: with the panel up, the same row
    // is the way out. Asserted through the real palette because the flip is
    // read from the store when the list is BUILT, so a stale build would show
    // "Show terminal" over an open panel.
    await openPalette();
    await $(paletteInput).setValue("terminal");
    await $(paletteDialog)
      .$("[data-pal-index]*=Hide terminal")
      .waitForDisplayed({
        timeout: 10_000,
        timeoutMsg:
          'the palette still offered "Show terminal" with the panel open',
      });
    await jsKey(paletteInput, "Escape");
  });
});
