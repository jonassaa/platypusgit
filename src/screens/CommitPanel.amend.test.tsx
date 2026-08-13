// Amend prefill: checking "Amend previous commit" loads HEAD's message into the
// composer so the button is usable and the old message is editable rather than
// silently replaced by whatever was in the box.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { CommitInfo, FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const head: CommitInfo = {
  oid: "aaaa111",
  shortOid: "aaaa111",
  summary: "feat: previous",
  body: "Why: it was needed.",
  author: "Ada",
  email: "ada@x.com",
  timestamp: 0,
  parents: ["bbbb222"],
  refs: [],
};

function setup(
  opts: {
    status?: FileStatus[];
    headCommits?: CommitInfo[];
    headPage?: () => Promise<{ commits: CommitInfo[]; nextCursor: null }>;
  } = {},
) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: opts.status ?? [staged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    logRef: null,
    loading: false,
  } as never);
  mockInvoke("get_diff", () => ({
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("get_status", () => opts.status ?? [staged("a.ts")]);
  mockInvoke("commit", () => "oid123");
  mockInvoke(
    "get_log_page",
    opts.headPage ??
      (() => ({ commits: opts.headCommits ?? [head], nextCursor: null })),
  );
  render(<CommitPanelScreen />);
}

const messageField = () =>
  screen.getByTestId<HTMLTextAreaElement>("commit-message");
const amendBox = () =>
  screen.getByLabelText<HTMLInputElement>("Amend previous commit");
const logPageCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "get_log_page");

describe("CommitPanel amend prefill", () => {
  beforeEach(() => {
    resetInvokeMock();
  });

  it("loads the previous commit message when amend is checked", async () => {
    setup();

    fireEvent.click(amendBox());

    await waitFor(() =>
      expect(messageField().value).toBe("feat: previous\n\nWhy: it was needed."),
    );
    expect(screen.getByTestId("commit-button")).toBeEnabled();
    expect(screen.getByTestId("commit-button").textContent).toContain("Amend");
  });

  it("reads HEAD even while the log is scoped to another ref", async () => {
    setup();
    useRepoStore.setState({ logRef: "origin/feature" } as never);

    fireEvent.click(amendBox());

    await waitFor(() => expect(logPageCalls()).toHaveLength(1));
    expect(logPageCalls()[0].args.refspec ?? null).toBeNull();
    expect(logPageCalls()[0].args.limit).toBe(1);
  });

  it("restores the draft that was in the box when amend is unchecked", async () => {
    setup();
    fireEvent.change(messageField(), { target: { value: "wip: my draft" } });

    fireEvent.click(amendBox());
    await waitFor(() =>
      expect(messageField().value).toBe("feat: previous\n\nWhy: it was needed."),
    );
    fireEvent.click(amendBox());

    await waitFor(() => expect(messageField().value).toBe("wip: my draft"));
  });

  it("offers an amend affordance on a clean tree", async () => {
    setup({ status: [] });

    fireEvent.click(screen.getByTestId("amend-last-commit"));

    await waitFor(() =>
      expect(messageField().value).toBe("feat: previous\n\nWhy: it was needed."),
    );
    expect(screen.getByTestId("commit-button")).toBeEnabled();
  });

  it("ignores a HEAD read that lands after amend was switched back off", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setup({
      headPage: () => gate.then(() => ({ commits: [head], nextCursor: null })),
    });
    fireEvent.change(messageField(), { target: { value: "wip: my draft" } });

    fireEvent.click(amendBox()); // starts the HEAD read
    fireEvent.click(amendBox()); // …and changes its mind before it lands
    release();

    await waitFor(() => expect(logPageCalls()).toHaveLength(1));
    expect(messageField().value).toBe("wip: my draft");
    expect(amendBox().checked).toBe(false);
  });

  it("backs the checkbox out again when there is no commit to amend", async () => {
    setup({ headCommits: [] });

    fireEvent.click(amendBox());

    await waitFor(() => expect(logPageCalls()).toHaveLength(1));
    await waitFor(() => expect(amendBox().checked).toBe(false));
    expect(messageField().value).toBe("");
  });
});
