import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { $, expect } from "@wdio/globals";
import { bareSourceRepo, type BareRepo } from "../support/tempRepo";
import { resetApp, waitRepoLoaded } from "../support/app";

describe("clone & init", () => {
  let dest: string;
  // Hoisted so afterEach can dispose it unconditionally — a bare source
  // fixture created by the clone test must not leak when an earlier
  // assertion in that test throws.
  let source: BareRepo | undefined;

  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), "pgit-create-"));
  });

  afterEach(async () => {
    await resetApp();
    rmSync(dest, { recursive: true, force: true });
    source?.dispose();
    source = undefined;
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
});
