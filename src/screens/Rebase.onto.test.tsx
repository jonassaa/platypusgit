// The diverged-base flow (186): a `rebase-onto` intent names a base, the screen
// walks `base..HEAD` on the backend, and the submitted plan carries that base on
// its first non-Drop step.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RebaseStep, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

const SWEPT: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
  lastCompleted: null,
};

const BASE = "9".repeat(40);
const ROOT = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function mk(oid: string, summary: string, parent: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "t@example.com",
    timestamp: 1_700_000_000,
    parents: [parent],
    refs: [],
  };
}

/** `base..HEAD`, newest-first — what `commits_between` returns. */
const RANGE = [mk(C, "feat: third", B), mk(B, "feat: second", A), mk(A, "feat: first", ROOT)];

/** Records what the screen actually submitted, and how it asked for the range. */
function wire(opts: {
  ahead: number;
  behind: number;
  mergeBase: string | null;
  range?: CommitInfo[];
}): { started: () => RebaseStep[][]; betweenLimits: () => Array<number | undefined> } {
  const started: RebaseStep[][] = [];
  const betweenLimits: Array<number | undefined> = [];
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: RANGE, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => SWEPT);
  mockInvoke("ahead_behind", () => ({
    ahead: opts.ahead,
    behind: opts.behind,
    mergeBase: opts.mergeBase,
  }));
  mockInvoke("commits_between", (args) => {
    betweenLimits.push((args as { limit?: number }).limit);
    return opts.range ?? RANGE;
  });
  mockInvoke("commits_since", () => opts.range ?? RANGE);
  mockInvoke("rebase_start", (args) => {
    started.push((args as { plan: RebaseStep[] }).plan);
    return SWEPT;
  });
  return { started: () => started, betweenLimits: () => betweenLimits };
}

function seedOntoIntent(): void {
  useNavStore.setState({ intent: { kind: "rebase-onto", base: BASE, label: "other" } });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: RANGE,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: SWEPT,
    activity: {},
  } as never);
  useNavStore.setState({ intent: null });
});

describe("RebaseScreen — a diverged base", () => {
  it("plans base..HEAD and submits the base on the first step", async () => {
    const rec = wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByText(/feat: /)).toHaveLength(3));
    // The limit is derived from `ahead`, never left to the handler's default of
    // 200 — a truncated plan would drop commits and still move the branch ref.
    expect(rec.betweenLimits()).toEqual([4]);

    await userEvent.click(screen.getByTestId("rebase-start"));

    await waitFor(() => expect(rec.started()).toHaveLength(1));
    const plan = rec.started()[0];
    expect(plan.map((s) => s.oid)).toEqual([A, B, C]);
    expect(plan.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("states what will be replayed, including the merge base", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    const strip = await screen.findByTestId("rebase-base-summary");
    expect(strip).toHaveTextContent("3 commits will be replayed onto other.");
    expect(strip).toHaveTextContent("other has 2 commits this branch does not.");
    expect(strip).toHaveTextContent(`Merge base ${ROOT.slice(0, 7)}.`);
  });

  it("warns when the histories are unrelated", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: null });
    seedOntoIntent();
    render(<RebaseScreen />);

    const strip = await screen.findByTestId("rebase-base-summary");
    expect(strip).toHaveTextContent("No common ancestor");
  });

  it("shows a visible notice and no plan when there is nothing to replay", async () => {
    const rec = wire({ ahead: 0, behind: 4, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    // The picker is CLOSED here — an intent has no anchor — so the notice has to
    // live on the screen or the menu item would fail in total silence.
    const notice = await screen.findByTestId("rebase-base-notice");
    expect(notice).toHaveTextContent("No commits between HEAD and other.");
    expect(screen.getByTestId("rebase-start")).toBeDisabled();
    expect(rec.betweenLimits()).toEqual([]);
  });

  it("refuses a partial range rather than planning a truncated rebase", async () => {
    wire({ ahead: 3, behind: 2, mergeBase: ROOT, range: RANGE.slice(0, 2) });
    seedOntoIntent();
    render(<RebaseScreen />);

    const notice = await screen.findByTestId("rebase-base-notice");
    expect(notice).toHaveTextContent("partial rebase");
    expect(screen.getByTestId("rebase-start")).toBeDisabled();
  });

  it("keeps the base on the first step after a reorder", async () => {
    const rec = wire({ ahead: 3, behind: 2, mergeBase: ROOT });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByTestId("rebase-move-up")).toHaveLength(3));
    // Move the newest commit (row 3) to the top. Without withPlanBase running at
    // SUBMIT, the base would still be sitting on the row that used to be first.
    await userEvent.click(screen.getAllByTestId("rebase-move-up")[2]);
    await userEvent.click(screen.getAllByTestId("rebase-move-up")[1]);

    await userEvent.click(screen.getByTestId("rebase-start"));
    await waitFor(() => expect(rec.started()).toHaveLength(1));
    const plan = rec.started()[0];
    expect(plan[0].oid).toBe(C);
    expect(plan.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("uses commits_since — not commits_between — for an ancestor base", async () => {
    const rec = wire({ ahead: 3, behind: 0, mergeBase: BASE });
    seedOntoIntent();
    render(<RebaseScreen />);

    await waitFor(() => expect(screen.getAllByText(/feat: /)).toHaveLength(3));
    expect(rec.betweenLimits()).toEqual([]);
  });
});
