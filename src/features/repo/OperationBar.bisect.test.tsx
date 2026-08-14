// The bisect half of the operation bar (#93).
//
// Two things matter enough to pin. First, the ACTIONS: `RepoState::Bisect` used to
// land in the bar's `opaque` bucket, whose only button was the generic Abort —
// `abort_operation`, a hard reset to HEAD, which mid-bisect is the detached commit
// being tested. So the one action offered for this state left the user worse off
// than doing nothing. Second, the COPY: git leaves HEAD on the last commit *tested*
// when the search converges, not on the culprit, so the bar has to name the culprit
// or the user blames the wrong commit.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperationBar, bisectDetail } from "./OperationBar";
import { useRepoStore } from "./useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import type { BisectStatus } from "@/lib/types";

vi.mock("@/features/merge/openMergeWindow", () => ({
  openMergeWindow: vi.fn().mockResolvedValue(undefined),
}));

const IDLE: BisectStatus = {
  inProgress: false,
  startRef: null,
  badTerm: "bad",
  goodTerm: "good",
  currentOid: null,
  remaining: null,
  steps: null,
  firstBadOid: null,
  goodCount: 0,
  badCount: 0,
  skippedCount: 0,
};

function bisecting(over: Partial<BisectStatus> = {}): BisectStatus {
  return {
    ...IDLE,
    inProgress: true,
    startRef: "main",
    currentOid: "9ab70c49e3fa5d3178e2bc9cdca3a1293b085d61",
    remaining: 4,
    steps: 2,
    goodCount: 1,
    badCount: 1,
    ...over,
  };
}

function wire() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Bisect");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("bisect_status", () => bisecting());
  mockInvoke("bisect_mark", () => bisecting());
  mockInvoke("bisect_reset", () => undefined);
  mockInvoke("abort_operation", () => undefined);
  mockInvoke("continue_operation", () => "abc1234");
}

function setup(status: BisectStatus) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: null },
    status: [],
    // Mid-bisect HEAD is detached, so there is no head branch — the realistic case.
    branches: [],
    repoState: "Bisect",
    bisectStatus: status,
  } as never);
  render(
    <WithDialogs>
      <OperationBar />
    </WithDialogs>,
  );
}

const called = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("OperationBar — bisect", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    wire();
  });

  it("announces the bisect with git's own progress numbers", () => {
    setup(bisecting());
    expect(screen.getByTestId("operation-bar").getAttribute("data-op")).toBe(
      "Bisect",
    );
    expect(screen.getByTestId("operation-title").textContent).toContain(
      "Bisect in progress",
    );
    expect(screen.getByTestId("operation-detail").textContent).toBe(
      "4 revisions left · ~2 steps",
    );
  });

  it("marks the current revision good / bad / skip", async () => {
    setup(bisecting());
    fireEvent.click(screen.getByTestId("bisect-good"));
    await vi.waitFor(() =>
      expect(called("bisect_mark")[0]?.args.mark).toBe("Good"),
    );

    fireEvent.click(screen.getByTestId("bisect-bad"));
    await vi.waitFor(() =>
      expect(called("bisect_mark")[1]?.args.mark).toBe("Bad"),
    );

    fireEvent.click(screen.getByTestId("bisect-skip"));
    await vi.waitFor(() =>
      expect(called("bisect_mark")[2]?.args.mark).toBe("Skip"),
    );
    // No rev: the mark applies to whatever git checked out for testing.
    expect(called("bisect_mark")[0]?.args.rev).toBeNull();
  });

  it("resets — never aborts — and confirms first", async () => {
    setup(bisecting());
    // The whole reason bisect is its own OpKind: the generic abort must not be
    // reachable here, because it hard-resets to a detached test commit.
    expect(screen.queryByTestId("operation-abort")).toBeNull();
    expect(screen.queryByTestId("operation-continue")).toBeNull();

    fireEvent.click(screen.getByTestId("bisect-reset"));
    expect(called("bisect_reset")).toHaveLength(0);
    await acceptDialog();
    await vi.waitFor(() => expect(called("bisect_reset")).toHaveLength(1));
    expect(called("abort_operation")).toHaveLength(0);
  });

  it("names the culprit once the search converges, and drops the marks", () => {
    setup(
      bisecting({
        firstBadOid: "6345d47106748909cca51e1c077db8e0fe11822f",
        remaining: null,
        steps: null,
      }),
    );
    const detail = screen.getByTestId("operation-detail").textContent ?? "";
    expect(detail).toContain("first bad commit 6345d47");
    // Saying so explicitly, because HEAD is NOT on it.
    expect(detail).toContain("HEAD is still on the last commit you tested");
    // Nothing left to test.
    expect(screen.queryByTestId("bisect-good")).toBeNull();
    expect(screen.queryByTestId("bisect-bad")).toBeNull();
    expect(screen.queryByTestId("bisect-skip")).toBeNull();
    expect(screen.getByTestId("bisect-reset")).toBeTruthy();
  });

  it("labels the marks with the repository's own terms", () => {
    setup(bisecting({ badTerm: "broken", goodTerm: "works" }));
    expect(screen.getByTestId("bisect-good").textContent).toContain("works");
    expect(screen.getByTestId("bisect-bad").textContent).toContain("broken");
  });
});

describe("bisectDetail", () => {
  it("asks for the missing end of the range before reporting progress", () => {
    // `git bisect start <bad>` with no good rev is legal; git waits.
    expect(bisectDetail(bisecting({ goodCount: 0 }))).toBe(
      "waiting for a good commit",
    );
    expect(bisectDetail(bisecting({ badCount: 0 }))).toBe(
      "waiting for a bad commit",
    );
    // Custom terms carry into the prompt too.
    expect(
      bisectDetail(bisecting({ badCount: 0, badTerm: "broken" })),
    ).toBe("waiting for a broken commit");
  });

  it("pluralizes, and mentions skips only when there are some", () => {
    expect(bisectDetail(bisecting({ remaining: 1, steps: 1 }))).toBe(
      "1 revision left · ~1 step",
    );
    expect(bisectDetail(bisecting({ skippedCount: 2 }))).toContain("2 skipped");
    expect(bisectDetail(bisecting())).not.toContain("skipped");
  });
});
