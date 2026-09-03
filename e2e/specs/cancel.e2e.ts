// Cancelling a stalled network op, through the real UI (#263 item 3).
//
// `src-tauri/tests/net_cancel.rs` covers the backend well: it stalls a real
// `git`, cancels the scope and asserts the error and the cleaned-up
// destination. What it cannot cover is the wiring in between — that the Clone
// dialog's one button really reaches `cancelClone`, and that the status bar
// really renders a Cancel beside a running fetch and really reaches
// `cancelNetworkOps`. Both are the kind of thing that regresses silently: a
// Cancel button that stops being rendered looks fine in a screenshot, and every
// unit test in the tree would stay green.
//
// The stall is deterministic and needs no network — see `stalledGitRemote`.
//
// What is deliberately NOT asserted here: the intermediate "Force stop" /
// "Cancelling…" labels. The polite SIGTERM kills a git that is blocked on a
// read in a few milliseconds, so that state is real but far too short-lived to
// poll for; `ActivityStatus.test.tsx` and `useCreateStore.cancel.test.ts` pin
// it where it can be observed. What these specs pin is the part only the real
// binary can answer: the click reached the backend, git actually stopped, and
// the user was not shown a failure for asking.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browser, $, expect } from "@wdio/globals";

import {
  basicRepo,
  stalledGitRemote,
  type StalledRemote,
  type TempRepo,
} from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

describe("cancelling a stalled network op", () => {
  let stalled: StalledRemote | undefined;
  let repo: TempRepo | undefined;
  let dest: string | undefined;

  afterEach(async () => {
    await resetApp();
    // The listener goes LAST: disposing it first would close the sockets and
    // let a still-running git fail on its own, which would hide a cancel that
    // never landed.
    repo?.dispose();
    repo = undefined;
    if (dest) rmSync(dest, { recursive: true, force: true });
    dest = undefined;
    stalled?.dispose();
    stalled = undefined;
  });

  it("the Clone dialog's own button stops a clone and takes the destination with it", async () => {
    stalled = await stalledGitRemote();
    dest = mkdtempSync(join(tmpdir(), "pgit-cancel-clone-"));

    await $('[data-testid="welcome-clone"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Welcome screen never showed the Clone button",
    });
    await $('[data-testid="welcome-clone"]').click();

    const urlInput = $('[data-testid="clone-url"]');
    await urlInput.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Clone dialog never opened",
    });
    await urlInput.setValue(stalled.url);
    await $('[data-testid="clone-parent"]').setValue(dest);
    // After the URL, so it wins over deriveRepoName's auto-fill.
    await $('[data-testid="clone-name"]').setValue("stalled");
    await $('[data-testid="clone-resolved"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg:
        "resolved path preview never appeared — did setValue's change event reach React state?",
    });

    await $('[data-testid="clone-submit"]').click();

    // One button, two jobs: its label is the dialog's own statement that a clone
    // is really in flight. Re-resolved on every poll — the dialog re-renders on
    // each progress tick, and a handle taken before one of those is dead.
    await browser.waitUntil(
      async () => (await $('[data-testid="clone-cancel"]').getText()) === "Cancel clone",
      {
        timeout: 30_000,
        timeoutMsg:
          "the clone never went busy — the Cancel button still reads as the dialog's close button",
      },
    );

    await $('[data-testid="clone-cancel"]').click();

    // Back to "Cancel" — i.e. `busy` is false again — is the dialog saying the
    // clone unwound. Against a remote that never answers, that can only happen
    // because the backend killed git: nothing else was ever going to return.
    await browser.waitUntil(
      async () => (await $('[data-testid="clone-cancel"]').getText()) === "Cancel",
      {
        timeout: 30_000,
        timeoutMsg:
          "the clone never unwound after Cancel — it is still running against the stalled remote",
      },
    );

    // A cancel is the outcome the user asked for, not a failure to report at
    // them. `git`'s dying words ("the remote end hung up unexpectedly") reaching
    // this slot is the regression this asserts against.
    expect(await $('[data-testid="clone-error"]').isExisting()).toBe(false);

    // repo truth: the partial destination is gone. Left there, the next attempt
    // fails `validate_clone_target` with "already exists and is not empty" — a
    // cancel button whose real effect is to poison the destination.
    expect(existsSync(join(dest, "stalled"))).toBe(false);
  });

  it("the status bar's Cancel stops a fetch that is hanging on a silent remote", async () => {
    stalled = await stalledGitRemote();
    repo = basicRepo();
    repo.git("remote", "add", "origin", stalled.url);
    await openRepo(repo.path);

    await $("button*=Fetch").click(); // titlebar → fetchAll

    // The status line is what tells the user something is running; the Cancel
    // beside it is the only way out, and `activity-cancel` is a state hook
    // rather than the button's prose (which a copy edit could move).
    await $('[data-testid="activity-label"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "the fetch never raised a status line",
    });
    await $('[data-testid="activity-cancel"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "a running fetch showed no Cancel — the only way out of a stall",
    });

    await $('[data-testid="activity-cancel"]').click();

    // The line going away IS the op unwinding: `withAuthRetry` clears the entry
    // in its `finally`, which only runs once `fetch_all` returned. Against a
    // remote that never answers it can only return because git was killed.
    await $('[data-testid="activity-label"]').waitForExist({
      reverse: true,
      timeout: 30_000,
      timeoutMsg:
        "the status line never cleared — the cancelled fetch is still running",
    });

    // No banner: `setErrorFor` drops `Cancelled` so the user's own Cancel click
    // is not answered with a red "early EOF".
    expect(await $('[role="alert"]').isExisting()).toBe(false);

    // repo truth. A fetch stalled on a network READ holds no lock, so this is a
    // guard rather than a proof — but it is the exact file whose survival is
    // what #263 is about, and the thing the NEXT fetch would die on.
    expect(existsSync(join(repo.path, ".git", "FETCH_HEAD.lock"))).toBe(false);
    // And nothing was fetched: no remote-tracking ref appeared out of a
    // connection that never carried a byte.
    expect(repo.git("branch", "-r").trim()).toBe("");
  });
});
