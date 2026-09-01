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
  jsTypeInTerminal,
  openRepo,
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
});
