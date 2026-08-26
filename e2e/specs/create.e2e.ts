import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { $, expect } from "@wdio/globals";
import {
  bareSourceRepo,
  stalledGitRemote,
  type BareRepo,
  type StalledRemote,
} from "../support/tempRepo";
import { resetApp, waitRepoLoaded } from "../support/app";

describe("clone & init", () => {
  let dest: string;
  // Hoisted so afterEach can dispose it unconditionally — a bare source
  // fixture created by the clone test must not leak when an earlier
  // assertion in that test throws.
  let source: BareRepo | undefined;
  // Same reason as `source`: a listener left open would keep a git child alive
  // past the test that started it.
  let stalled: StalledRemote | undefined;

  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), "pgit-create-"));
  });

  afterEach(async () => {
    await resetApp();
    rmSync(dest, { recursive: true, force: true });
    source?.dispose();
    source = undefined;
    stalled?.dispose();
    stalled = undefined;
  });

  it("initializes a new repository and opens it", async () => {
    await $('[data-testid="welcome-init"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Welcome screen never showed the New repository button",
    });
    await $('[data-testid="welcome-init"]').click();

    const parentInput = $('[data-testid="init-parent"]');
    await parentInput.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Init dialog never opened",
    });
    await parentInput.setValue(dest);
    await $('[data-testid="init-name"]').setValue("fresh");
    // Pin an explicit branch rather than leaving `defaultInitBranch()`'s
    // async fetch to fill it in — that also removes the race against that
    // fetch, and makes the HEAD assertion below actually prove the typed
    // value drives the backend rather than passing for any branch name.
    await $('[data-testid="init-branch"]').setValue("trunk");

    // These are controlled React inputs (PGInput's onChange yields a plain
    // string from a native <input>, same shape as the commit-message and
    // branch-search fields other specs already drive with setValue) — but
    // the resolved-path preview only renders once the typed value actually
    // reached useState, so waiting for it here is the real proof setValue's
    // change event landed, not an assumption borrowed from those specs.
    await $('[data-testid="init-resolved"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg:
        "resolved path preview never appeared — did setValue's change event reach React state?",
    });
    await expect($('[data-testid="init-resolved"]')).toHaveText(
      expect.stringContaining(`${dest}/fresh`),
    );

    await $('[data-testid="init-submit"]').click();
    await waitRepoLoaded();

    // repo truth: a real repository on disk, on the exact branch we typed
    // (not just "some" refs/heads/* — that would pass even if the dialog's
    // branch field were severed from runInit's `branch` argument entirely).
    expect(existsSync(join(dest, "fresh", ".git"))).toBe(true);
    const head = execFileSync("git", ["symbolic-ref", "HEAD"], {
      cwd: join(dest, "fresh"),
      encoding: "utf8",
    }).trim();
    expect(head).toBe("refs/heads/trunk");
  });

  it("clones from a local bare repository and opens it", async () => {
    // No network: a local bare repo with real commits drives the real clone
    // path (spawn, stderr streaming, exit status, destination handling) end
    // to end, with no credentials and no flake.
    source = bareSourceRepo();

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
    await urlInput.setValue(source.path);
    await $('[data-testid="clone-parent"]').setValue(dest);
    // Set after the URL so it lands after deriveRepoName's auto-fill from
    // the URL — this is the value that must win.
    await $('[data-testid="clone-name"]').setValue("cloned");

    await $('[data-testid="clone-resolved"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg:
        "resolved path preview never appeared — did setValue's change event reach React state?",
    });
    await expect($('[data-testid="clone-resolved"]')).toHaveText(
      expect.stringContaining(`${dest}/cloned`),
    );

    await $('[data-testid="clone-submit"]').click();
    await waitRepoLoaded();

    // repo truth: the source's exact known content cloned, not just "some
    // file, somewhere" — basicRepo() commits exactly a.txt and b.txt.
    expect(existsSync(join(dest, "cloned", ".git"))).toBe(true);
    const files = execFileSync("git", ["ls-files"], {
      cwd: join(dest, "cloned"),
      encoding: "utf8",
    });
    expect(files.trim().split("\n").sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("cancels a stalled clone, closing the dialog and leaving nothing behind", async () => {
    // The case #234 is about: a host that completes the TCP handshake and then
    // never answers. Before this, the only way out was force-quitting the app —
    // which left git finishing the transfer into a directory the frontend had
    // already given up on.
    stalled = await stalledGitRemote();

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
    await $('[data-testid="clone-name"]').setValue("cancelled");
    await $('[data-testid="clone-submit"]').click();

    // Running, and unable to finish. This wait is also the proof that the clone
    // really started — a URL git rejected outright would land in the error slot
    // instead, and there would be nothing to cancel.
    await $('[data-testid="clone-progress"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "the clone never started, so there was nothing to cancel",
    });

    // The one control the user reaches for, which used to be disabled here.
    const cancel = $('[data-testid="clone-cancel"]');
    expect(await cancel.isEnabled()).toBe(true);
    await cancel.click();

    // Back to Welcome: the dialog closed AND no repository was opened. It closes
    // only on the backend's `Cancelled`, so reaching this state means the
    // cleanup has already run.
    await $('[data-testid="welcome-clone"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg:
        "the Clone dialog never closed after Cancel — is the cancel reaching the backend?",
    });

    // repo truth: no half-written destination.
    expect(existsSync(join(dest, "cancelled"))).toBe(false);
  });
});
