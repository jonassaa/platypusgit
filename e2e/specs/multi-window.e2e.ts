// Multiple windows (docs/superpowers/specs/2026-09-04-multiple-windows-spec.md,
// #256): a second Tauri window running the whole app, with its own tab strip
// and its own repository.
//
// MULTI-WINDOW: like merge-window.e2e.ts, this spec drives a SECOND Tauri
// window through the embedded wdio driver — `browser.tauri.switchWindow("pg-1")`.
// The label is deterministic by design (`next_window_label` hands out the lowest
// free `pg-<n>`), which is what makes it nameable from here at all.
//
// PLATFORM: written for the HEADLESS Linux/WebKitGTK run (CI +
// `pnpm test:e2e:docker`). The macOS-native caveat merge-window.e2e.ts records
// applies here for the same reason: WKWebView's foreground-focus self-heal
// cannot keep a consistent active window across a second window's
// open/transition/close.
//
// NOT covered here, because the e2e binary gets EMPTY argv by construction
// (`e2e/wdio.conf.ts` passes no `appArgs`): which window a forwarded `pgit …`
// lands in. That rule is `WindowRegistry::route`, unit-tested in
// src-tauri/src/windows.rs.

import { browser, $, expect } from "@wdio/globals";
import {
  activeRepoTabPath,
  armDriverBridge,
  ensureMacAppFocus,
  jsClickMenuItem,
  jsContextMenu,
  openPalette,
  openRepo,
  paletteDialog,
  paletteInput,
  repoTab,
  repoTabCount,
  resetApp,
  seedOpenRepos,
  waitRepoLoaded,
} from "../support/app";
import { basicRepo, branchyRepo, TempRepo } from "../support/tempRepo";

/** The label every sibling window in this spec gets: the app hands out the
 *  lowest free `pg-<n>`, and `main` is the only other window up. */
const SIBLING = "pg-1";

/** Assert which repository the active tab is on.
 *
 *  Matched on the SUFFIX, exactly as `repoTab` is: the backend answers `open`
 *  with the canonicalised workdir, and on macOS a temp path arrives back as
 *  `/private/var/...` where the fixture spelled it `/var/...`. The last segment
 *  is unique across this spec's fixtures, so it is an identity match without
 *  depending on symlink resolution. */
async function expectActiveTab(repo: TempRepo): Promise<void> {
  const name = repo.path.split("/").filter(Boolean).pop() as string;
  const active = await activeRepoTabPath();
  expect(active ?? "").toMatch(new RegExp(`${name}$`));
}

/** The tab strip's selector for one repository, suffix-matched for the reason
 *  above. */
function tabSelector(repo: TempRepo): string {
  const name = repo.path.split("/").filter(Boolean).pop() as string;
  return `[data-testid="repo-tab"][data-path$="${name}"]`;
}

/** Click the palette row whose visible label contains `text`.
 *  (Copied from palette.e2e.ts — spec files never cross-import.) */
async function clickPaletteRow(text: string): Promise<void> {
  const row = $(paletteDialog).$(`[data-pal-index]*=${text}`);
  await row.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: `palette row "${text}" never appeared`,
  });
  await row.click();
}

/** Attach the driver to the sibling window. Re-arms the bridge and heals focus
 *  because this is a DIFFERENT document (per the e2e-testing re-arm rule). */
async function switchToSibling(): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        await browser.tauri.switchWindow(SIBLING);
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 20_000, timeoutMsg: `${SIBLING} never became switchable` },
  );
  await armDriverBridge();
  await ensureMacAppFocus();
}

async function switchToMain(): Promise<void> {
  await browser.tauri.switchWindow("main");
  await armDriverBridge();
}

/** Close the sibling through the Tauri API — `window.close()` does not close a
 *  Tauri window. Tolerant: a test may already have closed it. */
async function closeSibling(): Promise<void> {
  try {
    await browser.tauri.switchWindow(SIBLING);
    await browser.execute(() => {
      const w = window as unknown as Record<string, any>;
      void w.__TAURI__?.window?.getCurrentWindow?.().close();
    });
  } catch {
    /* no sibling window — fine */
  }
  await switchToMain();
}

describe("repository windows", () => {
  let repo: TempRepo | null = null;
  let other: TempRepo | null = null;

  afterEach(async () => {
    await closeSibling();
    await resetApp();
    repo?.dispose();
    repo = null;
    other?.dispose();
    other = null;
  });

  it("opens an empty second window from the palette", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await waitRepoLoaded();

    await openPalette();
    await $(paletteInput).setValue("New window");
    await clickPaletteRow("New window");

    await switchToSibling();
    // A whole second app, on Welcome: "new window" is deliberately EMPTY, not
    // a copy of what the first window was showing.
    await $("div*=Welcome to PlatypusGit").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the new window never rendered the app",
    });

    // …and the first window is untouched.
    await switchToMain();
    await expectActiveTab(repo);
  });

  it("opens THIS repository in a new window, keeping the tab here", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await waitRepoLoaded();

    await jsContextMenu('[data-testid="repo-tab"]');
    await jsClickMenuItem("Open in new window");

    await switchToSibling();
    await waitRepoLoaded();
    // The new window opened the repository itself, through its own seeded
    // session — nothing was handed to it over an event.
    await expectActiveTab(repo);

    await switchToMain();
    await expectActiveTab(repo);
    expect(await repoTabCount()).toBe(1);
  });

  it("moves a tab out: it leaves this window and arrives in the other", async () => {
    repo = basicRepo();
    other = branchyRepo();
    // Two tabs, seeded the way repo-tabs.e2e.ts does — this spec is about what
    // happens to a tab, not about how it got opened.
    await seedOpenRepos([repo.path, other.path], repo.path);
    await waitRepoLoaded();
    expect(await repoTabCount()).toBe(2);

    await jsContextMenu(tabSelector(other));
    await jsClickMenuItem("Move to new window");

    // Gone from here…
    await repoTab(other.path).waitForExist({
      reverse: true,
      timeout: 20_000,
      timeoutMsg: "the moved tab stayed in the window it left",
    });
    expect(await repoTabCount()).toBe(1);
    await expectActiveTab(repo);

    // …and it is what the new window is showing.
    await switchToSibling();
    await waitRepoLoaded();
    await expectActiveTab(other);
    expect(await repoTabCount()).toBe(1);
  });

  it("a window the user closes does not come back", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await waitRepoLoaded();

    await jsContextMenu('[data-testid="repo-tab"]');
    await jsClickMenuItem("Open in new window");
    await switchToSibling();
    await waitRepoLoaded();

    await closeSibling();

    // The close-versus-quit rule: a window destroyed while another survives is
    // forgotten, and the survivor is the one told to forget it. Asserted on the
    // restore record itself, because "it did not come back" is otherwise only
    // observable across a restart the suite cannot do.
    await browser.waitUntil(
      async () => (await browser.execute(() => localStorage.getItem("pg-windows"))) === "[]",
      {
        timeout: 20_000,
        timeoutMsg: "the closed window was still in the restore set",
      },
    );
    expect(
      await browser.execute(() => localStorage.getItem("pg-open-repos:pg-1")),
    ).toBeNull();
  });
});
