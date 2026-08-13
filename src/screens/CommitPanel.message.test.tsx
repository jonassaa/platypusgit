// One message box, not subject + body: git's message already means "first line
// is the subject, the rest is the body", so the composer holds it that way and
// sends it verbatim.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

function setup() {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [staged("a.ts")],
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
  mockInvoke("get_status", () => [staged("a.ts")]);
  mockInvoke("commit", () => "oid123");
  render(<CommitPanelScreen />);
}

const messageField = () =>
  screen.getByTestId<HTMLTextAreaElement>("commit-message");
const commitCall = () => getInvokeCalls().find((c) => c.cmd === "commit");

describe("CommitPanel message composer", () => {
  beforeEach(() => {
    resetInvokeMock();
    setup();
  });

  it("sends the typed message verbatim, subject line and body together", async () => {
    fireEvent.change(messageField(), {
      target: { value: "feat: thing\n\nWhy: because.\nAlso: this." },
    });
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: thing\n\nWhy: because.\nAlso: this.",
    );
  });

  it("counts only the subject line against the 50-char budget", () => {
    fireEvent.change(messageField(), {
      target: {
        value: "feat: short\n\nA body line that is comfortably past fifty characters long.",
      },
    });

    expect(screen.getByTestId("commit-subject-count").textContent).toBe("11/50");
  });

  it("trims trailing blank lines so a trailer block joins cleanly", async () => {
    fireEvent.change(messageField(), {
      target: { value: "feat: thing\n\nWhy: because.\n\n" },
    });
    fireEvent.change(screen.getByTestId("commit-coauthors"), {
      target: { value: "Ada <ada@x.com>" },
    });
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: thing\n\nWhy: because.\n\nCo-Authored-By: Ada <ada@x.com>",
    );
  });
});
