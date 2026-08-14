// Squashing a selection from History runs the rebase in place: the prompt
// arrives prefilled with the squashed commits' own messages, and accepting it
// starts (and finishes) the rebase without ever handing the user a plan screen.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStep } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

const mkCommit = (
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

const COMMITS = [
  mkCommit(A, "commit A", [B]),
  mkCommit(B, "commit B", [C], "why B"),
  mkCommit(C, "commit C", [D]),
  mkCommit(D, "commit D", []),
];

const DONE = { inProgress: false, nextIndex: 2, total: 2, pauseReason: null };

const rowFor = (text: string) => {
  const row = screen
    .getAllByText(text)
    .map((el) => el.closest("[data-pg-row]"))
    .find((el): el is Element => el != null);
  expect(row).toBeTruthy();
  return row! as HTMLElement;
};

const rebaseStartCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "rebase_start");

function seed() {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  mockInvoke("rebase_start", () => DONE);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => DONE);
}

/** Select commits A and B (base = C) and open the squash prompt. */
function openSquashPrompt() {
  fireEvent.click(rowFor("commit A"));
  fireEvent.click(rowFor("commit B"), { shiftKey: true });
  fireEvent.click(screen.getByTestId("multi-squash"));
}

describe("History squash", () => {
  beforeEach(seed);
  afterEach(() => vi.restoreAllMocks());

  it("prefills the prompt with both messages, oldest first", async () => {
    render(
      <WithDialogs>
        <HistoryScreen />
      </WithDialogs>,
    );
    openSquashPrompt();

    const input = await screen.findByTestId("dialog-input");
    // Oldest selected is B (with its body), then A.
    expect((input as HTMLTextAreaElement).value).toBe(
      "commit B\n\nwhy B\n\ncommit A",
    );
    expect(input.tagName).toBe("TEXTAREA");
  });

  it("runs the rebase itself and never routes to the plan screen", async () => {
    render(
      <WithDialogs>
        <HistoryScreen />
      </WithDialogs>,
    );
    openSquashPrompt();
    await screen.findByTestId("dialog-input");
    await acceptDialog("squashed message");

    await waitFor(() => expect(rebaseStartCalls().length).toBe(1));
    const plan = rebaseStartCalls()[0].args.plan as RebaseStep[];
    // Oldest-first: B anchors the squash as a pick, A folds into it.
    expect(plan).toEqual([
      { oid: B, action: "Pick", message: null },
      { oid: A, action: "Squash", message: "squashed message" },
    ]);
    // No rebase-plan intent — the user stays on History.
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("does nothing when the prompt is dismissed", async () => {
    render(
      <WithDialogs>
        <HistoryScreen />
      </WithDialogs>,
    );
    openSquashPrompt();
    await screen.findByTestId("dialog-input");
    fireEvent.click(screen.getByTestId("dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("dialog-input")).toBeNull());
    expect(rebaseStartCalls()).toEqual([]);
    expect(useNavStore.getState().intent).toBeNull();
  });
});
