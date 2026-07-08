import { $, expect } from "@wdio/globals";
import { basicRepo, type TempRepo } from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

/** Open the Settings screen via the titlebar gear. */
async function openSettings(): Promise<void> {
  await $('button[title="Settings"]').click();
  await $("div*=Default pull mode").waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: "Settings screen never appeared",
  });
}

describe("update prompt", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = null;
  });

  // Deterministic + offline: assert the Settings Updates section renders with a
  // version and a check button. We do NOT click "Check for updates" — that hits
  // the live GitHub API (flaky/networked) — and self-update is dormant in the
  // e2e build (no signed manifest). Discovery + install logic is unit-tested in
  // src/features/update/*.test.* instead.
  it("shows the Updates section with the current version and a check button", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await openSettings();

    const section = $('[data-testid="settings-updates"]');
    await section.waitForExist({
      timeout: 10_000,
      timeoutMsg: "Updates section never rendered",
    });

    // Section heading + version label are present.
    await expect(section).toHaveText(expect.stringContaining("Updates"));
    await expect(section.$("div*=Current version")).toBeExisting();

    // The manual check button exists (not clicked — see comment above).
    await expect(section.$("button*=Check for updates")).toBeExisting();
  });
});
