// The three history-rewriting flows behind the History context menu.
//
// One file rather than three: they share the log fixture, the dialog host and
// the refresh mocks, and the behaviour worth pinning is how they DIFFER from
// each other — which reads better side by side.
//
// Dialogs are rendered for real (the house pattern, `src/test/dialog.tsx`)
// rather than mocked: pgConfirm/pgPrompt resolve false/null with no host
// mounted, so a mocked-out dialog would make every one of these pass while
// asserting nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { rewordCommit } from "./rewordCommit";
import { dropCommit } from "./dropCommit";
import { undoCommit } from "./undoCommit";
import type { RewriteCtx } from "./rewriteWarning";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { WithDialogs, acceptDialog, dismissDialog, dialogBody, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStep } from "@/lib/types";

const A = "a".repeat(40); // tip
const B = "b".repeat(40);
const C = "c".repeat(40);
const ROOT = "d".repeat(40);

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

/** Newest-first, as the log is: A → B → C → ROOT. */
const COMMITS = [
  mk(A, "commit A", [B]),
  mk(B, "commit B", [C], "why B"),
  mk(C, "commit C", [ROOT]),
  mk(ROOT, "commit root", []),
];

const DONE = { inProgress: false, nextIndex: 2, total: 2, pauseReason: null };

const ctx = (over: Partial<RewriteCtx> = {}): RewriteCtx => ({
  commits: COMMITS,
  repoId: "r1",
  upstream: null,
  headOid: A,
  ...over,
});

/**
 * Wait for a dialog to actually be on screen, then accept it.
 *
 * Every flow `await`s the published-commit check before opening its confirm, so
 * accepting immediately races the dialog into existence and silently accepts
 * nothing.
 */
async function acceptWhenOpen(value?: string) {
  await screen.findByTestId("dialog-confirm");
  await acceptDialog(value);
}

/** Same race, for the decline path. */
async function dismissWhenOpen() {
  await screen.findByTestId("dialog-cancel");
  await dismissDialog();
}

const rebaseStarts = () => getInvokeCalls().filter((c) => c.cmd === "rebase_start");
const amends = () => getInvokeCalls().filter((c) => c.cmd === "amend_head_message");
const resets = () => getInvokeCalls().filter((c) => c.cmd === "reset");

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    branches: [],
    error: null,
    hookRejection: null,
    noSignature: false,
    loading: false,
  } as never);
  mockInvoke("rebase_start", () => DONE);
  mockInvoke("amend_head_message", () => ({ oid: "new1234", message: "reworded" }));
  mockInvoke("reset", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => DONE);
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 5, mergeBase: C }));
  render(
    <WithDialogs>
      <div />
    </WithDialogs>,
  );
});

afterEach(() => vi.restoreAllMocks());

describe("rewordCommit", () => {
  it("prefills the prompt with the commit's full existing message", async () => {
    void rewordCommit({ oid: B }, ctx());
    const input = (await screen.findByTestId("dialog-input")) as HTMLTextAreaElement;
    expect(input.value).toBe("commit B\n\nwhy B");
  });

  it("amends in place when the target is HEAD, with no rebase at all", async () => {
    void rewordCommit({ oid: A }, ctx({ headOid: A }));
    await screen.findByTestId("dialog-input");
    await acceptDialog("a new subject");
    await acceptDialog(); // the rewrite confirm

    await waitFor(() => expect(amends().length).toBe(1));
    expect(amends()[0].args).toMatchObject({ expectedOid: A, message: "a new subject" });
    expect(rebaseStarts()).toHaveLength(0);
  });

  it("runs a one-target Reword plan for an older commit", async () => {
    void rewordCommit({ oid: B }, ctx({ headOid: A }));
    await screen.findByTestId("dialog-input");
    await acceptDialog("reworded B");
    await acceptDialog();

    await waitFor(() => expect(rebaseStarts().length).toBe(1));
    expect(rebaseStarts()[0].args.plan as RebaseStep[]).toEqual([
      { oid: B, action: "Reword", message: "reworded B" },
      { oid: A, action: "Pick", message: null },
    ]);
    expect(amends()).toHaveLength(0);
  });

  it("does nothing when the message comes back unchanged", async () => {
    void rewordCommit({ oid: B }, ctx());
    await screen.findByTestId("dialog-input");
    // Accept without editing: the prefill IS the existing message.
    await acceptDialog();

    expect(amends()).toHaveLength(0);
    expect(rebaseStarts()).toHaveLength(0);
  });

  it("does nothing when the prompt is dismissed", async () => {
    void rewordCommit({ oid: A }, ctx());
    await screen.findByTestId("dialog-input");
    await dismissDialog();

    expect(amends()).toHaveLength(0);
    expect(rebaseStarts()).toHaveLength(0);
  });

  it("does nothing when the rewrite confirm is declined", async () => {
    void rewordCommit({ oid: A }, ctx());
    await screen.findByTestId("dialog-input");
    await acceptDialog("a new subject");
    await dismissDialog();

    expect(amends()).toHaveLength(0);
  });

  it("warns in the confirm when the commit is already published", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 4, behind: 0, mergeBase: C }));
    void rewordCommit({ oid: A }, ctx({ upstream: "origin/main" }));
    await screen.findByTestId("dialog-input");
    await acceptDialog("a new subject");

    await waitFor(() => expect(dialogBody()).toMatch(/already on origin\/main/));
    expect(dialogBody()).toMatch(/has to be forced/);
  });

  it("stays quiet when the commit is not published yet", async () => {
    void rewordCommit({ oid: A }, ctx({ upstream: "origin/main" }));
    await screen.findByTestId("dialog-input");
    await acceptDialog("a new subject");

    await waitFor(() => expect(dialogBody()).toBeTruthy());
    expect(dialogBody()).not.toMatch(/origin\/main/);
  });

  it("does nothing for a commit the log does not hold", async () => {
    await rewordCommit({ oid: "f".repeat(40) }, ctx());
    expect(screen.queryByTestId("dialog-input")).toBeNull();
    expect(amends()).toHaveLength(0);
  });
});

describe("dropCommit", () => {
  it("runs a plan that drops the target and picks everything newer", async () => {
    void dropCommit({ oid: B }, ctx());
    await acceptWhenOpen();

    await waitFor(() => expect(rebaseStarts().length).toBe(1));
    expect(rebaseStarts()[0].args.plan as RebaseStep[]).toEqual([
      { oid: B, action: "Drop", message: null },
      { oid: A, action: "Pick", message: null },
    ]);
  });

  it("names Revert as the non-destructive alternative", async () => {
    void dropCommit({ oid: B }, ctx());
    await waitFor(() => expect(dialogBody()).toMatch(/use Revert instead/));
  });

  it("does nothing when the confirm is declined", async () => {
    void dropCommit({ oid: B }, ctx());
    await dismissWhenOpen();
    expect(rebaseStarts()).toHaveLength(0);
  });

  it("does nothing for a root commit — there is no base to replay onto", async () => {
    await dropCommit({ oid: ROOT }, ctx());
    expect(rebaseStarts()).toHaveLength(0);
  });
});

describe("undoCommit", () => {
  it("soft-resets to the parent, leaving the work staged", async () => {
    void undoCommit({ oid: A }, ctx({ headOid: A }));
    await acceptWhenOpen();

    await waitFor(() => expect(resets().length).toBe(1));
    expect(resets()[0].args).toMatchObject({ target: B, mode: "Soft" });
  });

  it("says the changes are kept, so the entry is not read as a discard", async () => {
    void undoCommit({ oid: A }, ctx({ headOid: A }));
    await waitFor(() => expect(dialogBody()).toMatch(/stay in your working tree/));
  });

  it("does nothing for a commit that is not HEAD", async () => {
    await undoCommit({ oid: B }, ctx({ headOid: A }));
    expect(resets()).toHaveLength(0);
  });

  it("does nothing for a root commit at HEAD — there is no parent to reset to", async () => {
    await undoCommit({ oid: ROOT }, ctx({ headOid: ROOT }));
    expect(resets()).toHaveLength(0);
  });
});
