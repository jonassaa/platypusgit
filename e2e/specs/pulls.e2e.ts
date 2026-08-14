import { browser, $, expect } from "@wdio/globals";

import { basicRepo, type TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

/**
 * Pull / merge requests (#92) — the part reachable with no forge and no network.
 *
 * Everything past detection (listing, creating, checking out, validating a token)
 * needs a live GitHub or GitLab, so it lives in Rust parser tests against recorded
 * payloads and in frontend component tests against `mockInvoke`. Recorded as a Gap
 * on the PR, the same way #61 recorded it for the git-auth path.
 *
 * What IS verifiable here: the screen is reachable from the activity bar, and a
 * repository whose remote is not a forge renders the "no forge" EMPTY STATE rather
 * than an error banner — the distinction the design doc turns on.
 */
describe("pull requests screen", () => {
  let repo: TempRepo;

  before(async () => {
    repo = basicRepo();
    await openRepo(repo.path);
  });

  after(async () => {
    await resetApp();
    repo.dispose();
  });

  it("is reachable from the activity bar", async () => {
    await switchScreen("pulls");
    // The header names the screen even before any forge is detected.
    // `span*=`, not `div*=`: PGSectionHeader renders its children in a <span>.
    await $("span*=PULL REQUESTS").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Pull requests screen header never appeared",
    });
  });

  it("reports no forge as a STATE, not an error, for a repo with no remote", async () => {
    await switchScreen("pulls");
    await $("div*=No GitHub or GitLab remote found").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "no-forge empty state never appeared",
    });
    // A repository with no forge must not raise the app's error banner.
    expect(await $('[role="alert"]').isExisting()).toBe(false);
    // And the actions that need an API stay disabled rather than failing on click.
    expect(await $('[data-testid="pulls-new"]').isEnabled()).toBe(false);
    expect(await $('[data-testid="pulls-refresh"]').isEnabled()).toBe(false);
  });

  it("asks which forge a self-hosted host is, instead of guessing", async () => {
    // A self-hosted GitHub Enterprise and a self-hosted GitLab are identical in a
    // git URL, so detection reports the host with an unknown kind.
    repo.git("remote", "add", "origin", "git@git.example.test:team/svc.git");
    await switchScreen("history");
    await switchScreen("pulls");
    await $("div*=Which forge is git.example.test?").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "unknown-host empty state never appeared",
    });
    expect(await $('[role="alert"]').isExisting()).toBe(false);
  });

  it("asks for a token once the host's forge is known", async () => {
    // github.com needs no configuration — its forge is a builtin.
    repo.git("remote", "set-url", "origin", "git@github.com:jonassaa/platypusgit.git");
    await switchScreen("history");
    await switchScreen("pulls");
    await $("div*=Add an API token for github.com").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "signed-out empty state never appeared",
    });
    // The empty state has to say the API token is NOT the push credential, or it
    // reads as if the app lost the credential the user already has.
    await $("div*=separate credential from the one git pushes with").waitForDisplayed(
      {
        timeout: 10_000,
        timeoutMsg: "token/push-credential distinction never rendered",
      },
    );
  });

  it("routes to the Settings integrations section", async () => {
    await switchScreen("pulls");
    const button = $('[data-testid="pulls-open-settings"]');
    await button.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Open Settings button never appeared",
    });
    await button.click();
    await $('[data-testid="settings-forge"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Settings integrations section never appeared",
    });
    // The token field is a password input, so a screen share of Settings cannot
    // carry the secret.
    const field = $('[data-testid="forge-token-github.com"]');
    await field.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "forge token field never appeared",
    });
    expect(await field.getAttribute("type")).toBe("password");
  });
});
