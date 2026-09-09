// The three history-rewriting entries added for Rider parity, and the retrofit
// that put Squash and Fixup behind the same published-commit warning.
//
// What is asserted here is ENABLEMENT and the reason in the label — the flows
// themselves are covered in features/commits/rewriteFlows.test.tsx. A disabled
// entry in this codebase says why it is disabled in its own label, so the label
// text is the contract, not decoration.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { commitMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { WithDialogs, acceptDialog, dialogBody, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { CommitInfo } from "@/lib/types";

const HEAD_SHA = "a".repeat(40); // tip of main
const B = "b".repeat(40);
const MERGE = "e".repeat(40); // an OLDER merge, in HEAD's ancestry
const SIDE = "5".repeat(40); // the merge's second parent
const C = "c".repeat(40);
const ROOT = "d".repeat(40);
const OFF_BRANCH = "f".repeat(40); // reachable in the log, not from HEAD

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

// Newest-first. HEAD_SHA → B → MERGE(→ C, SIDE) → C → ROOT, plus a commit on
// another branch that History's all-branch walk also returns.
const COMMITS = [
  mk(HEAD_SHA, "commit A", [B]),
  mk(OFF_BRANCH, "commit on another branch", [C]),
  mk(B, "commit B", [MERGE], "why B"),
  mk(MERGE, "Merge branch 'side'", [C, SIDE]),
  mk(SIDE, "side work", [C]),
  mk(C, "commit C", [ROOT]),
  mk(ROOT, "commit root", []),
];

const DONE = { inProgress: false, nextIndex: 2, total: 2, pauseReason: null };

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

/** Point HEAD at `oid` and rebuild nothing else. */
function headAt(oid: string) {
  useRepoStore.setState({
    headInfo: { branch: "main", headOid: oid },
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        tip: oid,
        tipTime: 0,
        isDefault: true,
      },
    ],
  } as never);
}

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    error: null,
    hookRejection: null,
    noSignature: false,
    loading: false,
  } as never);
  headAt(HEAD_SHA);
  useNavStore.setState({ intent: null });
  mockInvoke("rebase_start", () => DONE);
  mockInvoke("amend_head_message", () => ({ oid: "new1234", message: "x" }));
  mockInvoke("reset", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => DONE);
  // Not published, unless a case says otherwise.
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 3, mergeBase: C }));
});

afterEach(() => vi.restoreAllMocks());

describe("Edit commit message", () => {
  it("is offered for a commit on this branch", () => {
    const item = labeled(commitMenuItems({ sha: B }), /^Edit commit message/);
    expect(item.disabled).toBeFalsy();
    expect(item.label).toBe("Edit commit message…");
  });

  it("is offered for HEAD even when HEAD is a merge — an amend keeps its parents", () => {
    headAt(MERGE);
    const item = labeled(commitMenuItems({ sha: MERGE }), /^Edit commit message/);
    expect(item.disabled).toBeFalsy();
  });

  it("is refused for an OLDER merge commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: MERGE }), /^Edit commit message/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/merge commit/);
  });

  it("is refused for a commit that is not on this branch, and says why", () => {
    const item = labeled(commitMenuItems({ sha: OFF_BRANCH }), /^Edit commit message/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/not on this branch/);
  });

  it("is refused for the root commit unless it is HEAD", () => {
    const item = labeled(commitMenuItems({ sha: ROOT }), /^Edit commit message/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/root commit/);
  });
});

describe("Undo this commit", () => {
  it("is offered for HEAD", () => {
    const item = labeled(commitMenuItems({ sha: HEAD_SHA }), /^Undo this commit/);
    expect(item.disabled).toBeFalsy();
    expect(item.label).toBe("Undo this commit…");
  });

  it("is refused for any other commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: B }), /^Undo this commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/only the last commit/);
  });

  it("is refused for a root commit sitting at HEAD", () => {
    headAt(ROOT);
    const item = labeled(commitMenuItems({ sha: ROOT }), /^Undo this commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/root commit/);
  });
});

describe("Drop this commit", () => {
  it("is offered for a non-merge commit on this branch, and is danger-styled", () => {
    const item = labeled(commitMenuItems({ sha: B }), /^Drop this commit/);
    expect(item.disabled).toBeFalsy();
    expect(item.danger).toBe(true);
  });

  it("is refused for a merge commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: MERGE }), /^Drop this commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/merge commit/);
  });

  it("is refused for the root commit", () => {
    const item = labeled(commitMenuItems({ sha: ROOT }), /^Drop this commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/root commit/);
  });

  it("is refused for a commit not on this branch", () => {
    const item = labeled(commitMenuItems({ sha: OFF_BRANCH }), /^Drop this commit/);
    expect(item.disabled).toBe(true);
  });
});

describe("the published-commit warning is shared by all five rewrite entries", () => {
  beforeEach(() => {
    // behind === 0 → the commit is contained in origin/main.
    mockInvoke("ahead_behind", () => ({ ahead: 4, behind: 0, mergeBase: C }));
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
  });

  it("warns in the fixup confirm", async () => {
    void labeled(commitMenuItems({ sha: B }), /^Fixup this commit/).onClick?.();
    await waitFor(() => expect(dialogBody()).toMatch(/already on origin\/main/));
  });

  it("warns inside the squash PROMPT, not a second dialog in front of it", async () => {
    void labeled(commitMenuItems({ sha: B }), /^Squash this commit/).onClick?.();
    // The prompt is the FIRST and only dialog: an input is present, and the
    // warning is in its body.
    await screen.findByTestId("dialog-input");
    expect(dialogBody()).toMatch(/already on origin\/main/);
  });

  it("warns in the drop confirm", async () => {
    void labeled(commitMenuItems({ sha: B }), /^Drop this commit/).onClick?.();
    await waitFor(() => expect(dialogBody()).toMatch(/already on origin\/main/));
  });

  it("warns in the undo confirm", async () => {
    void labeled(commitMenuItems({ sha: HEAD_SHA }), /^Undo this commit/).onClick?.();
    await waitFor(() => expect(dialogBody()).toMatch(/already on origin\/main/));
  });

  it("warns in the reword confirm, after the message prompt", async () => {
    void labeled(commitMenuItems({ sha: HEAD_SHA }), /^Edit commit message/).onClick?.();
    await screen.findByTestId("dialog-input");
    await acceptDialog("a new subject");
    await waitFor(() => expect(dialogBody()).toMatch(/already on origin\/main/));
  });
});

describe("a declined fixup confirm", () => {
  it("starts no rebase", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(commitMenuItems({ sha: B }), /^Fixup this commit/).onClick?.();
    const cancel = await screen.findByTestId("dialog-cancel");
    cancel.click();
    await waitFor(() =>
      expect(getInvokeCalls().filter((c) => c.cmd === "rebase_start")).toHaveLength(0),
    );
  });
});
