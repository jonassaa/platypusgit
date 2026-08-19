// AppShell's nav-intent routing table — the whole table, every kind.
//
// `stash-vs-wt` (#133) shipped declared in `NavIntent`, emitted by the stash
// context menu and fully handled by `CommitDiff` — with no `case` in AppShell's
// routing switch. The menu item set an intent and nothing navigated: a feature
// dead on arrival, past review, unit tests, component tests and e2e.
//
// Nothing caught it because nothing tested the ROUTING. `CommitDiff.stash`
// renders that screen directly with the intent pre-set, so it stayed green while
// the only way a user can reach the screen was broken.
//
// Two mechanisms close that, and the first is the stronger one:
//
//  1. AppShell's switch ends in `default: assertNever(intent)`. An unrouted kind
//     is a COMPILE error — `pnpm tsc --noEmit`, `pnpm build`, and every editor.
//     No test needs to run.
//  2. This file drives each kind through the real shell and asserts the screen
//     changed, which the compile check cannot do: a lazy `case "x": break;`
//     satisfies the type-checker while still going nowhere.
//
// `EXPECTED` is a mapped type over `NavIntent["kind"]`, so a new kind fails to
// compile here until it is given a sample and a destination. That indirection is
// necessary: a union has no runtime representation, so the kinds cannot be
// enumerated at run time — the type system has to do the enumerating.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import App from "./App";
import type { ScreenId } from "./AppShell";
import { useNavStore, type NavIntent } from "@/features/nav/useNavStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, FileDiff, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "r1", path: "/repo", head: "refs/heads/main" };

const OID = "a".repeat(40);
const OID2 = "b".repeat(40);

const COMMITS: CommitInfo[] = [OID, OID2].map((oid, i) => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: `commit ${i}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000 - i,
  parents: i === 0 ? [OID2] : [],
  refs: i === 0 ? ["refs/heads/main"] : [],
}));

const DIFF: FileDiff = {
  path: "src/a.ts",
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [],
  lfs: null,
};

/**
 * One representative intent per kind, and the screen the shell must land on.
 *
 * `screen: null` declares a kind that intentionally leaves the user where they
 * are, and the type REQUIRES a reason for it — an omission has to be argued for
 * in writing rather than achieved by leaving a row out, which is the hole this
 * file exists to close. There are none today: every declared intent navigates.
 */
type Expectation<K extends NavIntent["kind"]> = {
  intent: Extract<NavIntent, { kind: K }>;
} & ({ screen: ScreenId } | { screen: null; reason: string });

const EXPECTED: { [K in NavIntent["kind"]]: Expectation<K> } = {
  "diff-file": {
    intent: { kind: "diff-file", path: "src/a.ts" },
    screen: "diff",
  },
  "commit-self": {
    intent: { kind: "commit-self", oid: OID },
    screen: "commitDiff",
  },
  "commit-vs-wt": {
    intent: { kind: "commit-vs-wt", oid: OID },
    screen: "commitDiff",
  },
  "commit-vs-commit": {
    intent: { kind: "commit-vs-commit", from: OID2, to: OID },
    screen: "commitDiff",
  },
  "ref-compare": {
    intent: {
      kind: "ref-compare",
      left: { kind: "rev", rev: "main" },
      right: { kind: "workdir" },
    },
    screen: "compare",
  },
  "file-history": {
    intent: { kind: "file-history", path: "src/a.ts" },
    screen: "fileHistory",
  },
  blame: {
    intent: { kind: "blame", path: "src/a.ts" },
    screen: "blame",
  },
  "rebase-plan": {
    intent: { kind: "rebase-plan", plan: [] },
    screen: "rebase",
  },
  // The diverged-base flow (186). The intent names a base and nothing else —
  // the SCREEN resolves the range, because the log is paged and a branch menu
  // has no commit list at all.
  "rebase-onto": {
    intent: { kind: "rebase-onto", base: OID2, label: "other" },
    screen: "rebase",
  },
  // The two stash comparisons (#133). `stash-vs-wt` is the regression: revert
  // AppShell's `case "stash-vs-wt":` and this row fails with "history".
  "stash-diff": {
    intent: { kind: "stash-diff", oid: OID, label: "stash@{0}", untracked: false },
    screen: "commitDiff",
  },
  "stash-vs-wt": {
    intent: { kind: "stash-vs-wt", oid: OID, label: "stash@{0}", untracked: false },
    screen: "commitDiff",
  },
  "switch-screen": {
    intent: { kind: "switch-screen", screen: "branches" },
    screen: "branches",
  },
};

/** Everything the shell and any destination screen may reach for on mount. */
function wire(): void {
  for (const cmd of [
    "get_status",
    "list_all_files",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
    "list_submodules",
    "list_worktrees",
    "get_reflog",
    "diff_commit",
    "diff_commits",
    "stash_diff",
    "file_history",
    "blame_file",
    "commits_since",
    "commits_between",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("take_launch_intent", () => null);
  mockInvoke("cli_shim_status", () => ({ installed: false, path: null }));
  mockInvoke("get_diff", () => DIFF);
  mockInvoke("diff_ref_to_workdir", () => ({ files: [DIFF], untrackedOmitted: 0 }));
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 0, mergeBase: null }));
  mockInvoke("read_file_content", () => ({ text: "", binary: false }));
  mockInvoke("read_file_content_at_rev", () => ({ text: "", binary: false }));
  mockInvoke("get_update_capability", () => ({ supported: false, reason: null }));
  mockInvoke("check_for_update", () => null);
  mockInvoke("forge_detect", () => null);
  mockInvoke("lfs_status", () => ({ available: false, tracked: [], files: [] }));
}

/** The screen the shell routed to — see `data-pg-screen` in AppBody. */
function currentScreen(container: HTMLElement): string | null {
  return container
    .querySelector("[data-pg-screen]")
    ?.getAttribute("data-pg-screen") ?? null;
}

describe("AppShell routes every NavIntent kind", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentsStore.setState({ recents: [] });
    useNavStore.setState({ intent: null, deepOrigin: null });
    wire();
    useRepoStore.setState({
      current: handle,
      status: [],
      allFiles: [],
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: COMMITS,
      loading: false,
      error: null,
      repoState: "Clean",
      rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
      activity: {},
    } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  // A sample filed under the wrong key would leave its own kind unproven while
  // testing another one twice. The mapped type already refuses it; this says so
  // in a sentence a failing run can print.
  it("files every sample under its own kind", () => {
    for (const [kind, exp] of Object.entries(EXPECTED)) {
      expect(exp.intent.kind).toBe(kind);
      if (exp.screen === null) expect(exp.reason.length).toBeGreaterThan(0);
    }
  });

  for (const [kind, exp] of Object.entries(EXPECTED) as Array<
    [NavIntent["kind"], Expectation<NavIntent["kind"]>]
  >) {
    const target = exp.screen ?? "(deliberately nowhere)";
    it(`sends "${kind}" to ${target}`, async () => {
      const { container } = await act(async () => render(<App />));
      // Launch always lands on History, so any change below is this intent's.
      expect(currentScreen(container)).toBe("history");

      await act(async () => {
        useNavStore.getState().setIntent(exp.intent);
      });

      if (exp.screen === null) {
        // Held on purpose (`reason`), not lost: assert it did NOT move.
        expect(currentScreen(container)).toBe("history");
      } else {
        await waitFor(() => expect(currentScreen(container)).toBe(exp.screen));
      }
    });
  }
});
