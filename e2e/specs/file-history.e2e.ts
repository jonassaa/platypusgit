import { browser, $, $$, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  changeRow,
  executeOnce,
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  switchScreen,
} from "../support/app";

// One file's history over the real IPC boundary (#474).
//
// The interesting half is not the list — the component tests cover that against
// a mocked `invoke`. It is the WIRE: `file_history` answers with a struct now
// (`commits` / `visited` / `stoppedAt`) rather than an array, it takes a new
// `searchAll` argument, and `cancel_walk` is a new command. A serde rename that
// arrived as `stopped_at`, or an argument Tauri would not convert, breaks none
// of the 4,176 mocked tests and every real click — the shape of break this
// suite exists for (see `docs/dev/testing.md` on the same trap in #435).

/** The file-history screen's own pane — a signal no other screen can satisfy. */
const HISTORY_PANE = '[data-pg-pane="fileHistory.list"]';
const HISTORY_ROWS = `${HISTORY_PANE} [data-pg-row]`;

/** Every history row's text, in order. */
async function rowTexts(): Promise<string[]> {
  const rows = await $$(HISTORY_ROWS);
  const out: string[] = [];
  for (const row of rows) out.push((await row.getText()).trim());
  return out;
}

/** `window.__TAURI__.core`, as every direct-IPC spec spells it. */
type Bridge = {
  __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
};

describe("file history", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    // `a.txt` is committed twice and `b.txt` once, so "the commits that touched
    // THIS file" is a different list from "the log".
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the changes list",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  async function openHistoryOfA(): Promise<void> {
    await jsContextMenu('[data-testid="changes-list"] [data-path="a.txt"]');
    await jsClickMenuItem("File history");
    // The destination's own pane first: a row selector could otherwise bind to
    // the commit screen we are leaving.
    await $(HISTORY_PANE).waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "the file-history screen never opened",
    });
  }

  it("lists the commits that touched the file, newest first", async () => {
    await openHistoryOfA();

    // Repo truth is the acceptance; the row count is the wait.
    const subjects = repo
      .git("log", "--format=%s", "--", "a.txt")
      .trim()
      .split("\n");
    expect(subjects).toEqual(["fix: update a.txt", "feat: add a.txt"]);

    await browser.waitUntil(
      async () => (await rowTexts()).length === subjects.length,
      {
        timeout: 30_000,
        timeoutMsg: `expected ${subjects.length} history rows for a.txt`,
      },
    );

    const texts = await rowTexts();
    expect(texts[0]).toContain("fix: update a.txt");
    expect(texts[1]).toContain("feat: add a.txt");
    // b.txt's commit is in the log and not in THIS file's history.
    expect(texts.join("\n")).not.toContain("add b.txt");
  });

  it("claims no search limit when it reached the end of history", async () => {
    await openHistoryOfA();
    await browser.waitUntil(async () => (await rowTexts()).length === 2, {
      timeout: 30_000,
      timeoutMsg: "history rows never appeared",
    });

    // The notice is the whole user-visible point of `stoppedAt`. On a
    // three-commit repository the honest answer is silence — a notice here
    // would mean the frontend cannot read the field at all and is treating
    // every walk as truncated.
    await expect($('[data-testid="history-limit-notice"]')).not.toBeExisting();
  });

  // The field names, over the real bridge. Nothing on screen distinguishes
  // `stoppedAt` from an unreadable `stopped_at` — both render the same list
  // with no notice — so this asks the backend directly.
  it("answers with the struct the frontend reads, field for field", async () => {
    const answer = await browser.execute(async (repoPath: string) => {
      const core = (window as unknown as Bridge).__TAURI__?.core;
      if (!core) return { error: "no bridge" };
      try {
        const open = (await core.invoke("open_repo", { path: repoPath })) as {
          id: string;
        };
        const history = await core.invoke("file_history", {
          repoId: open.id,
          path: "a.txt",
          limit: 200,
          searchAll: false,
        });
        return { history };
      } catch (e) {
        return { error: String(e) };
      }
    }, repo.path);

    expect(answer.error).toBeUndefined();
    const history = answer.history as {
      commits: { summary: string }[];
      visited: number;
      stoppedAt: string;
    };
    expect(history.commits.map((c) => c.summary)).toEqual([
      "fix: update a.txt",
      "feat: add a.txt",
    ]);
    // Every commit was examined to find those two, and the walk ended because
    // history did — not because either ceiling was reached.
    expect(history.visited).toBe(
      Number(repo.git("rev-list", "--count", "HEAD").trim()),
    );
    expect(history.stoppedAt).toBe("Exhausted");
  });

  // `searchAll` and `cancel_walk` are both new argv over the bridge, and both
  // fail SILENTLY when wrong: the screen only sends `searchAll: false`, and the
  // frontend swallows a `cancel_walk` rejection because a walk that finished
  // first is the ordinary case. A fixture cannot make a walk slow enough to
  // cancel through the UI, so this asks the commands directly.
  it("accepts a waived cap and a cancel for a repository with nothing running", async () => {
    const answer = await executeOnce(async (repoPath: string) => {
      const core = (window as unknown as Bridge).__TAURI__?.core;
      if (!core) return { error: "no bridge" };
      try {
        const open = (await core.invoke("open_repo", { path: repoPath })) as {
          id: string;
        };
        const all = (await core.invoke("file_history", {
          repoId: open.id,
          path: "a.txt",
          limit: 200,
          searchAll: true,
        })) as { commits: unknown[]; stoppedAt: string };
        const signalled = (await core.invoke("cancel_walk", {
          repoId: open.id,
        })) as number;
        return { matches: all.commits.length, stoppedAt: all.stoppedAt, signalled };
      } catch (e) {
        return { error: String(e) };
      }
    }, repo.path);

    expect(answer.error).toBeUndefined();
    expect(answer.matches).toBe(2);
    expect(answer.stoppedAt).toBe("Exhausted");
    // Nothing was running, which is a count of zero and not a failure.
    expect(answer.signalled).toBe(0);
  });
});
