/**
 * @vitest-environment node
 */
// The stale-handle wait gate (issue #364).
//
// `waitForDisplayed` is `waitUntil(() => isDisplayed())` over an element
// HANDLE, and `isDisplayed` resolves its selector exactly once — the first
// poll caches `elementId` and no later poll re-runs the selector. A detached
// node then reports "not displayed" without raising stale, so WebdriverIO's
// error handler never refetches and the wait polls a dead node for its ENTIRE
// budget with the element it wanted on screen the whole time. Raising the
// timeout cannot help.
//
// That is one mechanism behind a whole table of "flaky" specs — the clean-state
// waits in commit.e2e, the renamed-remote row, settings after a reload — and it
// only bites when a re-render lands between the find and the visibility check,
// which is why it is a CI-only failure on a starved runner.
//
// The fix is session-wide: `installStaleProofWaits()` overwrites the command so
// every poll re-resolves the selector. Session-wide is the point — 227 call
// sites, and a helper only fixes the ones that adopt it. But a session-wide fix
// installed from one line in one hook is also a fix that can be deleted in one
// line, with nothing failing until CI goes red weeks later. So the install is
// pinned here, as a static fact, at `pnpm test` speed.
//
// The behaviour itself (a swapped node no longer kills the wait, a genuinely
// absent element still fails) is pinned in e2e/specs/harness.e2e.ts, which is
// the only place that can actually drive a browser.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8");

/** Source with comments blanked out — this file's own prose, and the long doc
 *  comments in e2e/, name every symbol below and would satisfy a naive
 *  `includes`. Newlines preserved so line numbers still mean something. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const conf = stripComments(read("e2e/wdio.conf.ts"));
const app = stripComments(read("e2e/support/app.ts"));

describe("e2e stale-handle wait gate", () => {
  it("installs the re-resolving waits from the conf's before hook", () => {
    expect(conf).toContain("installStaleProofWaits");
    // In `before`, not in some later hook: element overrides attach when an
    // element object is created, so an install after the first `$()` would
    // leave those elements — including the conf's own Welcome-screen wait — on
    // the unfixed command.
    const before = conf.slice(conf.indexOf("before: async"), conf.indexOf("after: async"));
    expect(before).toContain("await installStaleProofWaits()");
  });

  it("keeps the command override to that single helper", () => {
    // A second overwrite of the same command silently wins or silently loses
    // depending on install order, and either way the behaviour pinned by
    // harness.e2e.ts stops describing what the suite runs.
    expect(conf).not.toContain("overwriteCommand");
    expect(app.match(/overwriteCommand\(/g)).toHaveLength(1);
    const helper = app.slice(app.indexOf("export async function installStaleProofWaits"));
    expect(helper.slice(0, helper.indexOf("\n}\n"))).toContain("overwriteCommand");
  });

  it("re-resolves with a WebDriver find, never an in-page poll", () => {
    // The #194 rule still applies inside the fix: `waitForDisplayed` is a legal
    // settle gate after a refresh *because* it is a find, and re-implementing
    // it over `document.querySelector` would put the mid-document-swap stall
    // back into every one of the 227 sites at once.
    const helper = app.slice(app.indexOf("export async function installStaleProofWaits"));
    const body = helper.slice(0, helper.indexOf("\n}\n"));
    expect(body).toContain("this.parent.$(selector)");
    expect(body).not.toMatch(/browser\.execute|executeOnce\(|querySelector/);
  });

  it("keeps one clean-state selector instead of matching rendered prose", () => {
    // `div*=Working tree clean` pinned a required CI gate to a PGEmpty title,
    // and resolved to whichever innermost div happened to contain the phrase.
    const specs = read("e2e/specs/commit.e2e.ts") + read("e2e/specs/stash.e2e.ts") + read("e2e/specs/keymap.e2e.ts");
    expect(stripComments(specs)).not.toContain("Working tree clean");
    expect(app).toContain('WORKING_TREE_CLEAN = \'[data-testid="working-tree-clean"]\'');
    expect(read("src/screens/CommitPanel.tsx")).toContain(
      'data-testid="working-tree-clean"',
    );
  });

  it("keeps the spec-file retry floor, and keeps it loud", () => {
    // The floor absorbs what no wait can — a starved runner losing the app
    // itself ("app never rendered Welcome screen"), which used to fail the
    // whole required check. A SILENT retry would be worse than none: it would
    // hide a real regression behind a green gate. So the requeue has to be
    // reported where someone will see it.
    expect(conf).toContain("specFileRetries: 1");
    expect(conf).toContain("specFileRetriesDeferred: true");
    const hook = conf.slice(conf.indexOf("onWorkerEnd:"));
    const body = hook.slice(0, hook.indexOf("\n  framework:"));
    expect(body).toContain("::warning");
    expect(body).toContain("GITHUB_STEP_SUMMARY");
  });
});
