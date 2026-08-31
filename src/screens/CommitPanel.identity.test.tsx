// A fresh machine's first commit (#212).
//
// git refuses to record a commit until `user.name` and `user.email` are set, so
// this is the first thing a brand-new user hits — and before #212 it was an
// error banner reading the literal string "NoSignature", with nothing anywhere
// in the app that could set an identity. These tests pin the two halves of the
// fix: the refusal becomes a form, and answering it makes the commit the user
// already asked for.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { appErrorMessage } from "@/lib/errors";
import type { FileStatus, GitIdentity } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const NO_IDENTITY: GitIdentity = {
  name: null,
  email: null,
  globalConfigPath: "/home/ada/.gitconfig",
};

/** How many times `commit` has been attempted. */
const commitCalls = () => getInvokeCalls().filter((c) => c.cmd === "commit");
const setIdentityCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "set_identity");

function setup({
  identity = NO_IDENTITY,
  onSetIdentity,
}: {
  identity?: GitIdentity;
  onSetIdentity?: () => void;
} = {}) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [staged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    logRef: null,
    loading: false,
    error: null,
    noSignature: false,
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
  mockInvoke("get_identity", () => identity);
  // The identity is missing until `set_identity` succeeds; after that the
  // commit goes through. One pair of handlers models the whole story — and the
  // backend refuses anything git would refuse, writing nothing.
  let hasIdentity = false;
  mockInvoke("set_identity", (args) => {
    onSetIdentity?.();
    if (String(args.name).includes("<")) {
      throw { kind: "InvalidArgument", message: "a name cannot contain '<'" };
    }
    hasIdentity = true;
    return null;
  });
  mockInvoke("commit", () => {
    if (!hasIdentity) throw { kind: "NoSignature" };
    return { oid: "oid123", message: "feat: thing" };
  });
  render(<CommitPanelScreen />);
}

const typeMessage = (text: string) =>
  fireEvent.change(screen.getByTestId("commit-message"), {
    target: { value: text },
  });

async function commitAndGetRefused() {
  typeMessage("feat: thing");
  fireEvent.click(screen.getByTestId("commit-button"));
  await waitFor(() => expect(screen.getByTestId("no-signature")).toBeTruthy());
}

describe("CommitPanel — no committer identity (#212)", () => {
  beforeEach(() => {
    resetInvokeMock();
  });

  it("turns the refusal into a form instead of an error banner", async () => {
    setup();
    await commitAndGetRefused();

    // The refusal is NOT in `error`: an error is something you acknowledge,
    // and this is something you answer.
    expect(useRepoStore.getState().error).toBeNull();
    expect(useRepoStore.getState().noSignature).toBe(true);
    // And the enum's spelling must never reach the screen.
    expect(document.body.textContent).not.toContain("NoSignature");
    expect(screen.getByTestId("identity-name")).toBeTruthy();
    expect(screen.getByTestId("identity-email")).toBeTruthy();
  });

  it("names the file it is about to write", async () => {
    setup();
    await commitAndGetRefused();
    expect(screen.getByTestId("identity-target").textContent).toContain(
      "/home/ada/.gitconfig",
    );
  });

  it("will not offer to save until both halves are filled in", async () => {
    setup();
    await commitAndGetRefused();
    const save = screen.getByTestId<HTMLButtonElement>("identity-save");
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("identity-name"), {
      target: { value: "Ada Lovelace" },
    });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "ada@example.com" },
    });
    expect(save.disabled).toBe(false);

    // Whitespace is not an answer.
    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "   " },
    });
    expect(save.disabled).toBe(true);
  });

  it("saves the identity and then makes the commit the user already asked for", async () => {
    setup();
    await commitAndGetRefused();
    expect(commitCalls()).toHaveLength(1);

    fireEvent.change(screen.getByTestId("identity-name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("identity-save"));

    await waitFor(() => expect(setIdentityCalls()).toHaveLength(1));
    expect(setIdentityCalls()[0].args).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });

    // The retry is the point: the user typed a message and pressed Commit, and
    // making them press it again is a second failure with extra steps.
    await waitFor(() => expect(commitCalls()).toHaveLength(2));
    expect(commitCalls()[1].args.message).toBe("feat: thing");
    await waitFor(() =>
      expect(useRepoStore.getState().noSignature).toBe(false),
    );
  });

  it("keeps the prompt up and commits nothing when the backend refuses the identity", async () => {
    setup();
    await commitAndGetRefused();

    fireEvent.change(screen.getByTestId("identity-name"), {
      target: { value: "Ada <Lovelace>" },
    });
    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("identity-save"));

    await waitFor(() =>
      expect(screen.getByTestId("identity-error").textContent).toContain(
        "cannot contain",
      ),
    );
    // No second commit attempt — a refused save has not fixed anything.
    expect(commitCalls()).toHaveLength(1);
    expect(screen.getByTestId("no-signature")).toBeTruthy();
  });

  it("can be dismissed, and a fresh attempt clears the stale prompt", async () => {
    setup();
    await commitAndGetRefused();

    fireEvent.click(screen.getByTestId("identity-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("no-signature")).toBeNull(),
    );
    expect(useRepoStore.getState().noSignature).toBe(false);
  });

  it("says which repository is overriding the identity, so a global save is not a mystery", async () => {
    setup({
      identity: {
        name: { value: "Repo Local", scope: "repository" },
        email: { value: "local@example.com", scope: "repository" },
        globalConfigPath: "/home/ada/.gitconfig",
      },
    });
    await commitAndGetRefused();
    const note = screen.getByTestId("identity-scope-note").textContent ?? "";
    expect(note).toContain("This repository sets its own");
    // No issue numbers in prose a user reads.
    expect(note).not.toMatch(/#\d+/);
  });

  it("names both halves' sources when they disagree", async () => {
    // `user.name` from /etc/gitconfig and `user.email` from ~/.gitconfig is an
    // ordinary state on a managed machine; reporting only the first would be a
    // confident wrong answer about the second.
    setup({
      identity: {
        name: { value: "Managed Name", scope: "system" },
        email: { value: "ada@example.com", scope: "global" },
        globalConfigPath: "/home/ada/.gitconfig",
      },
    });
    await commitAndGetRefused();
    const source = screen.getByTestId("identity-source").textContent ?? "";
    expect(source).toContain("this machine");
    expect(source).toContain("your global git config");
  });

  it("says which half is still missing when only one is set", async () => {
    setup({
      identity: {
        name: { value: "Ada Lovelace", scope: "global" },
        email: null,
        globalConfigPath: "/home/ada/.gitconfig",
      },
    });
    await commitAndGetRefused();
    expect(screen.getByTestId("identity-source").textContent).toContain(
      "the other is not set",
    );
  });
});

describe("appErrorMessage — NoSignature (#212)", () => {
  it("never renders the enum's own spelling", () => {
    // The regression this whole issue turned on: `NoSignature` is a UNIT
    // variant, so it carries no message, and `appErrorMessage`'s `|| e.kind`
    // fallback put "NoSignature" on screen wherever it was raised — merge,
    // cherry-pick, revert, rebase, tag, stash, not only commit.
    const msg = appErrorMessage({ kind: "NoSignature" });
    expect(msg).not.toBe("NoSignature");
    expect(msg).toContain("user.name");
    expect(msg).toContain("user.email");
  });
});
