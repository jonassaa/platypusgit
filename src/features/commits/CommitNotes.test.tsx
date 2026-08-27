// `git notes` in the commit detail panel (#253).
//
// The two behaviours that matter are opposites: a note must be visible with its
// ref labelled (a note on `refs/notes/review` and one on `refs/notes/commits`
// mean different things), and a commit with NO note must render nothing at all
// — no heading, no empty box. Most commits in most repositories have no notes,
// so an "empty notes" affordance would be permanent furniture.
//
// The third is a cost contract: notes are read for the SELECTED commit only,
// and arrowing through the log must not fire one read per row passed over.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CommitNotes } from "./CommitNotes";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { CommitNote } from "@/lib/types";

const noteCalls = () => getInvokeCalls().filter((c) => c.cmd === "commit_notes");

const NOTE: CommitNote = {
  refName: "refs/notes/commits",
  label: "commits",
  message: "Reviewed-by: Ada\nCI: green",
};

beforeEach(() => {
  resetInvokeMock();
  vi.useRealTimers();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "main" },
  } as never);
  mockInvoke("commit_notes", () => [NOTE]);
});

describe("CommitNotes", () => {
  it("renders the note and the ref it came from", async () => {
    render(<CommitNotes oid={"a".repeat(40)} />);

    await waitFor(() => expect(screen.getByTestId("commit-notes")).toBeTruthy());
    expect(screen.getByTestId("commit-notes").textContent).toContain(
      "Reviewed-by: Ada",
    );
    expect(screen.getByTestId("commit-notes").textContent).toContain("commits");
  });

  it("labels each note with its own ref when several exist", async () => {
    mockInvoke("commit_notes", () => [
      NOTE,
      { refName: "refs/notes/review", label: "review", message: "LGTM" },
    ]);
    render(<CommitNotes oid={"a".repeat(40)} />);

    await waitFor(() => expect(screen.getByTestId("commit-notes")).toBeTruthy());
    const text = screen.getByTestId("commit-notes").textContent ?? "";
    expect(text).toContain("commits");
    expect(text).toContain("review");
    expect(text).toContain("LGTM");
  });

  it("renders nothing for a commit with no notes", async () => {
    mockInvoke("commit_notes", () => []);
    render(<CommitNotes oid={"b".repeat(40)} />);

    await waitFor(() => expect(noteCalls()).toHaveLength(1));
    expect(screen.queryByTestId("commit-notes")).toBeNull();
  });

  it("renders nothing when the read fails", async () => {
    // A repository the backend refused to read notes from is still a
    // perfectly viewable commit; a banner here would be noise.
    mockInvoke("commit_notes", () => {
      throw new Error("boom");
    });
    render(<CommitNotes oid={"c".repeat(40)} />);

    await waitFor(() => expect(noteCalls()).toHaveLength(1));
    expect(screen.queryByTestId("commit-notes")).toBeNull();
  });

  it("does not read notes for a commit that was only arrowed past", async () => {
    const { rerender } = render(<CommitNotes oid={"1".repeat(40)} />);
    rerender(<CommitNotes oid={"2".repeat(40)} />);
    rerender(<CommitNotes oid={"3".repeat(40)} />);

    await waitFor(() => expect(noteCalls()).toHaveLength(1));
    expect(noteCalls()[0].args.oid).toBe("3".repeat(40));
  });
});
