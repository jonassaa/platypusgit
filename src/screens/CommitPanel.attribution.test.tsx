// Author override + Co-Authored-By trailers (#61 D1). The backend has honored
// CommitOptions.author_override since the commit op was written; nothing sent
// it until now.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CommitPanelScreen,
  coAuthorTrailers,
  parseIdentity,
} from "./CommitPanel";
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
  mockInvoke("commit", () => "oid123");
  mockInvoke("get_status", () => [staged("a.ts")]);
  render(<CommitPanelScreen />);
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const commitCall = () => getInvokeCalls().find((c) => c.cmd === "commit");

describe("parseIdentity", () => {
  it("accepts Name <email> and trims", () => {
    expect(parseIdentity("  Ada Lovelace  < ada@example.com > ")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "   ", "Ada Lovelace", "ada@example.com", "<a@b.c>"]) {
      expect(parseIdentity(bad), bad).toBeNull();
    }
  });
});

describe("coAuthorTrailers", () => {
  it("splits on commas and newlines, and dedupes case-insensitively", () => {
    expect(
      coAuthorTrailers("Ada <ada@x.com>, Grace <grace@x.com>\nADA <ADA@X.COM>"),
    ).toEqual([
      "Co-Authored-By: Ada <ada@x.com>",
      "Co-Authored-By: Grace <grace@x.com>",
    ]);
  });

  it("drops unparseable entries instead of emitting them malformed", () => {
    // GitHub only credits a trailer it can parse.
    expect(coAuthorTrailers("nonsense, Ada <ada@x.com>, also nonsense")).toEqual([
      "Co-Authored-By: Ada <ada@x.com>",
    ]);
    expect(coAuthorTrailers("")).toEqual([]);
  });
});

describe("CommitPanel attribution", () => {
  beforeEach(() => {
    resetInvokeMock();
    setup();
  });

  it("sends no authorOverride by default", async () => {
    type("commit-message", "feat: plain");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.authorOverride).toBeNull();
    expect(commitCall()!.args.message).toBe("feat: plain");
  });

  it("sends the parsed author override", async () => {
    type("commit-message", "feat: as ada");
    type("commit-author", "Ada Lovelace <ada@example.com>");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.authorOverride).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("blocks the commit while the author is half-typed", async () => {
    type("commit-message", "feat: blocked");
    type("commit-author", "Ada Lovelace");

    expect(screen.getByTestId("commit-button")).toBeDisabled();
    expect(screen.getByTestId("commit-attribution").textContent).toContain(
      "Name <email@example.com>",
    );

    // Completing it re-enables — the gate is about validity, not presence.
    type("commit-author", "Ada Lovelace <ada@example.com>");
    expect(screen.getByTestId("commit-button")).toBeEnabled();
  });

  it("appends Co-Authored-By trailers after a blank line", async () => {
    type("commit-message", "feat: pairing");
    type("commit-coauthors", "Ada <ada@x.com>, Grace <grace@x.com>");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: pairing\n\nCo-Authored-By: Ada <ada@x.com>\nCo-Authored-By: Grace <grace@x.com>",
    );
  });

  it("keeps the trailer block separate from a body", async () => {
    type("commit-message", "feat: pairing\n\nWhy: because.");
    type("commit-coauthors", "Ada <ada@x.com>");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: pairing\n\nWhy: because.\n\nCo-Authored-By: Ada <ada@x.com>",
    );
  });

  it("does not duplicate a trailer the body already spells out", async () => {
    type("commit-message", "feat: pairing\n\nCo-Authored-By: Ada <ada@x.com>");
    type("commit-coauthors", "Ada <ada@x.com>");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: pairing\n\nCo-Authored-By: Ada <ada@x.com>",
    );
  });

  it("keeps attribution after a commit — pairing spans several commits", async () => {
    type("commit-message", "feat: one");
    type("commit-author", "Ada Lovelace <ada@example.com>");
    type("commit-coauthors", "Grace <grace@x.com>");
    fireEvent.click(screen.getByTestId("commit-button"));

    await waitFor(() => expect(commitCall()).toBeDefined());
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>("commit-message").value).toBe(""),
    );
    expect(screen.getByTestId<HTMLInputElement>("commit-author").value).toBe(
      "Ada Lovelace <ada@example.com>",
    );
    expect(screen.getByTestId<HTMLInputElement>("commit-coauthors").value).toBe(
      "Grace <grace@x.com>",
    );
  });
});
