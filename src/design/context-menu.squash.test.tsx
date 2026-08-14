// The right-click Squash/Fixup entries are a separate call site from History's
// action-row buttons, and they used to differ: an empty message prompt and a
// hand-off to the Rebase plan screen. Both now prefill and run in place.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { commitMenuItems, commitMultiMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStep } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

const mk = (
  oid: string,
  summary: string,
  parents: string[],
  body: string | null = null,
): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

// Newest-first, as the log is: A → B → C → D(root).
const COMMITS = [
  mk(A, "commit A", [B]),
  mk(B, "commit B", [C], "why B"),
  mk(C, "commit C", [D]),
  mk(D, "commit D", []),
];

const DONE = { inProgress: false, nextIndex: 2, total: 2, pauseReason: null };

const rebaseStarts = () => getInvokeCalls().filter((c) => c.cmd === "rebase_start");

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    branches: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  mockInvoke("rebase_start", () => DONE);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => DONE);
});

afterEach(() => vi.restoreAllMocks());

describe("right-click Squash on a multi-commit selection", () => {
  it("prefills both messages and runs the rebase without routing to the plan screen", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    // Selection A + B (contiguous, base = C).
    const item = labeled(commitMultiMenuItems([A, B]), /^Squash 2 into one/);
    expect(item.disabled).toBeFalsy();
    void item.onClick?.();

    const input = (await screen.findByTestId("dialog-input")) as HTMLTextAreaElement;
    expect(input.value).toBe("commit B\n\nwhy B\n\ncommit A");
    await acceptDialog("combined message");

    await waitFor(() => expect(rebaseStarts().length).toBe(1));
    expect(rebaseStarts()[0].args.plan as RebaseStep[]).toEqual([
      { oid: B, action: "Pick", message: null },
      { oid: A, action: "Squash", message: "combined message" },
    ]);
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("stays disabled for a non-contiguous selection", () => {
    const item = labeled(commitMultiMenuItems([A, C]), /^Squash 2 —/);
    expect(item.disabled).toBe(true);
  });

  // With every branch in one log, a selection can span branches. Squash rewrites
  // the CURRENT branch, so such a selection must be refused rather than quietly
  // replaying the foreign commit onto it.
  it("refuses a selection that isn't all on the current branch", () => {
    const FEATURE = "f".repeat(40);
    useRepoStore.setState({
      // Interleaved as the all-branches walk really returns it.
      commits: [
        mk(A, "commit A", [B]),
        mk(FEATURE, "feat: elsewhere", [B]),
        mk(B, "commit B", [C], "why B"),
        mk(C, "commit C", [D]),
        mk(D, "commit D", []),
      ],
      branches: [
        {
          name: "main",
          isHead: true,
          isRemote: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          tip: A,
        },
      ],
    } as never);

    const item = labeled(
      commitMultiMenuItems([A, FEATURE]),
      /^Squash 2 — not all on this branch/,
    );
    expect(item.disabled).toBe(true);
    // Cherry-pick keeps working across branches — that is its whole point.
    expect(labeled(commitMultiMenuItems([A, FEATURE]), /Cherry-pick 2/).disabled).toBeFalsy();
  });
});

describe("right-click Squash into parent", () => {
  it("prefills parent-then-commit and runs in place", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    // Squash B into its parent C.
    const item = labeled(
      commitMenuItems({ sha: B, subject: "commit B" }),
      /Squash this commit into its parent/,
    );
    void item.onClick?.();

    const input = (await screen.findByTestId("dialog-input")) as HTMLTextAreaElement;
    expect(input.value).toBe("commit C\n\ncommit B\n\nwhy B");
    await acceptDialog("folded");

    await waitFor(() => expect(rebaseStarts().length).toBe(1));
    expect(useNavStore.getState().intent).toBeNull();
  });
});

describe("right-click Fixup into parent", () => {
  it("runs in place with no prompt and no plan screen", async () => {
    const item = labeled(
      commitMenuItems({ sha: B, subject: "commit B" }),
      /Fixup this commit into its parent/,
    );
    await item.onClick?.();

    await waitFor(() => expect(rebaseStarts().length).toBe(1));
    const plan = rebaseStarts()[0].args.plan as RebaseStep[];
    expect(plan.find((s) => s.oid === B)?.action).toBe("Fixup");
    expect(useNavStore.getState().intent).toBeNull();
  });
});
