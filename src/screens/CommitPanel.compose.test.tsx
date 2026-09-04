// The commit-message composition surface (#252), at the screen.
//
// The pure halves are tested next to their modules
// (features/commits/message/*.test.ts). What is pinned HERE is the wiring that
// only exists once the screen is real: that a template pre-fills but never
// overwrites, that the message actually SENT is the cleaned one, that the
// affordances compose into the same ordinary textarea, and that none of it
// broke sign-off, recall or attribution.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { pgPickOption, pgSelectValues } from "@/test/select";
import type { BranchInfo, CommitInfo, CommitTemplate, FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const branch = (name: string): BranchInfo => ({
  name,
  isHead: true,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "abc1234",
  tipTime: 0,
  isDefault: false,
});

const commit = (summary: string, body: string | null = null): CommitInfo => ({
  oid: "aaa1111",
  shortOid: "aaa1111",
  summary,
  body,
  author: "Ada",
  email: "ada@example.com",
  timestamp: 0,
  parents: ["parent"],
  refs: [],
});

const NO_TEMPLATE: CommitTemplate = {
  path: null,
  body: null,
  unreadable: false,
  commentPrefix: "#",
  cleanup: "default",
};

const template = (over: Partial<CommitTemplate>): CommitTemplate => ({
  ...NO_TEMPLATE,
  ...over,
});

interface SetupOpts {
  template?: CommitTemplate;
  branchName?: string;
  commits?: CommitInfo[];
}

function setup(opts: SetupOpts = {}) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [staged("a.ts")],
    branches: [branch(opts.branchName ?? "main")],
    remotes: [],
    commits: opts.commits ?? [],
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
  mockInvoke("commit", () => ({ oid: "oid123", message: "" }));
  mockInvoke("get_commit_template", () => opts.template ?? NO_TEMPLATE);
  return render(<CommitPanelScreen />);
}

const messageField = () => screen.getByTestId<HTMLTextAreaElement>("commit-message");
const commitCall = () => getInvokeCalls().find((c) => c.cmd === "commit");
const type = (value: string) =>
  fireEvent.change(messageField(), { target: { value } });
const typePicker = () => screen.getByTestId("commit-type");

beforeEach(() => {
  resetInvokeMock();
  useSettingsStore.getState().reset();
});

afterEach(() => {
  useSettingsStore.getState().reset();
});

// ═════════════════════════════════════════════════════════════════════════════
// commit.template
// ═════════════════════════════════════════════════════════════════════════════

describe("commit.template", () => {
  it("pre-fills an empty box, comments and all — as git's editor does", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "subject\n\n# why?\n" }) });
    await waitFor(() => expect(messageField().value).toBe("subject\n\n# why?\n"));
  });

  it("never overwrites a draft the user already typed", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "TEMPLATE\n" }) });
    // Types before the template read resolves — the race the guard is for.
    type("my own words");
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    expect(messageField().value).toBe("my own words");
  });

  it("leaves the box alone when no template is configured", async () => {
    setup();
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    expect(messageField().value).toBe("");
  });

  it("says so when commit.template names a file that is not there", async () => {
    setup({ template: template({ path: "/repo/gone.txt", unreadable: true }) });
    const notice = await screen.findByTestId("commit-template-missing");
    // Named, not swallowed: the whole point is that the user can go fix it.
    expect(notice.textContent).toContain("/repo/gone.txt");
    // …and the screen still works.
    type("feat: thing");
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(false);
  });

  it("survives a backend that cannot answer at all", async () => {
    useRepoStore.setState({
      current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
      status: [staged("a.ts")],
      branches: [branch("main")],
      remotes: [],
      commits: [],
      logRef: null,
      loading: false,
    } as never);
    mockInvoke("get_diff", () => ({
      path: "a.ts", oldPath: null, binary: false, additions: 0, deletions: 0, hunks: [],
    }));
    mockInvoke("get_status", () => [staged("a.ts")]);
    mockInvoke("commit", () => ({ oid: "oid123", message: "" }));
    // get_commit_template deliberately unmocked → the invoke mock rejects.
    render(<CommitPanelScreen />);
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    type("feat: thing");
    expect(messageField().value).toBe("feat: thing");
  });

  it("comes back after a commit, because git re-applies it every time", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "# describe the change\n" }) });
    await waitFor(() => expect(messageField().value).toBe("# describe the change\n"));
    type("feat: thing");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    await waitFor(() => expect(messageField().value).toBe("# describe the change\n"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// COMMENT STRIPPING — the bug the issue names
// ═════════════════════════════════════════════════════════════════════════════

describe("comment stripping on commit", () => {
  it("strips the template's comment lines instead of committing them", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "\n# Why is this change needed?\n" }) });
    await waitFor(() => expect(messageField().value).toContain("# Why"));
    type("feat: thing\n\n# Why is this change needed?\nBecause.\n");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("feat: thing\n\nBecause.");
  });

  it("keeps a # that is not the first character of its line", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "seed\n" }) });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("fix: crash\n\nCloses the #123 report");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("fix: crash\n\nCloses the #123 report");
  });

  it("honours core.commentChar rather than assuming #", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "x", commentPrefix: ";" }) });
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    type("feat: thing\n; a hint\n#123 kept");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("feat: thing\n#123 kept");
  });

  it("shows how many lines it is about to drop", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "seed\n" }) });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("feat: thing\n# one\n# two\n");
    const notice = await screen.findByTestId("commit-comment-notice");
    expect(notice.textContent).toMatch(/2 lines/);
  });

  it("refuses to commit a template message that is nothing but comments", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "seed\n" }) });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("# just a comment\n# and another\n");
    // git calls this an empty commit message and aborts. Committing it would
    // create a commit whose message is the instructions.
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(true);
    expect(screen.queryByTestId("commit-comment-notice")).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// …AND WHERE IT MUST NOT APPLY
// ═════════════════════════════════════════════════════════════════════════════

// git's `default` cleanup strips comments only when the message went through
// the EDITOR. `git commit -m "#123 fix the thing"` commits `#123 fix the
// thing`, and our box is `-m` until a template puts comments in it. Getting
// this wrong deletes the user's own words.
describe("a message the user typed is `git commit -m`", () => {
  it("commits a #123 subject as written, and keeps Commit enabled", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("#123 fix the thing");
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(false);
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("#123 fix the thing");
  });

  it("keeps a whole comment-shaped body, and says nothing about stripping", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("#123 fix\n\n# a heading, not a comment\nbody\n");
    expect(screen.queryByTestId("commit-comment-notice")).toBeNull();
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "#123 fix\n\n# a heading, not a comment\nbody",
    );
  });

  it("still applies the whitespace half, which git does in both modes", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("#123 fix   \n\n\n\nbody\n\n\n");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("#123 fix\n\nbody");
  });

  it("strips once the repository's template has seeded the box", async () => {
    // Same keystrokes, different context — the one distinction git makes.
    setup({ template: template({ path: "/repo/.gitmessage", body: "seed\n" }) });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("#123 fix the thing");
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(true);
  });

  it("obeys an explicit commit.cleanup=strip even with no template", async () => {
    setup({ template: template({ cleanup: "strip" }) });
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    type("feat: thing\n# a note\n");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("feat: thing");
  });

  it("obeys an explicit commit.cleanup=whitespace even from a template", async () => {
    setup({
      template: template({
        path: "/repo/.gitmessage",
        body: "seed\n",
        cleanup: "whitespace",
      }),
    });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("feat: thing\n# kept on purpose\n");
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("feat: thing\n# kept on purpose");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// commit.cleanup = verbatim (#387)
// ═════════════════════════════════════════════════════════════════════════════

// Verbatim means verbatim: the cleanup keeps every space, so `cleaned` is a
// poor question for the gate to ask. What is SENT is `cleaned` with its end
// trimmed — this app's one deviation from git — so a box holding nothing but
// spaces is an empty commit message however verbatim the mode. The gate and
// the send path have to ask that one question, or Commit lights up for a
// message the backend receives as "".
describe("commit.cleanup=verbatim", () => {
  it("keeps Commit off for a box holding nothing but spaces and tabs", async () => {
    setup({ template: template({ cleanup: "verbatim" }) });
    await screen.findByTestId("commit-type");
    type("   \t \n  \t\n");
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(true);
  });

  it("does not let a co-author trailer stand in for the message", async () => {
    setup({ template: template({ cleanup: "verbatim" }) });
    await screen.findByTestId("commit-type");
    type("   ");
    fireEvent.change(screen.getByTestId("commit-coauthors"), {
      target: { value: "Ada <ada@x.com>" },
    });
    // A trailer is an addition to a message, never a substitute for one.
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(true);
  });

  it("still commits whitespace that has words around it, untouched", async () => {
    setup({ template: template({ cleanup: "verbatim" }) });
    await screen.findByTestId("commit-type");
    type("  subject   \n\n\n# kept\n");
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(false);
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe("  subject   \n\n\n# kept");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TICKET PREFIX
// ═════════════════════════════════════════════════════════════════════════════

describe("the ticket chip", () => {
  it("offers the ticket the branch name carries, and inserts it on click", async () => {
    setup({ branchName: "feat/PROJ-123-commit-help" });
    const chip = await screen.findByTestId("commit-ticket");
    expect(chip.textContent).toContain("PROJ-123");
    type("do the thing");
    fireEvent.click(screen.getByTestId("commit-ticket"));
    expect(messageField().value).toBe("PROJ-123 do the thing");
  });

  it("goes after a conventional prefix, not in front of it", async () => {
    setup({ branchName: "feat/PROJ-123-commit-help" });
    await screen.findByTestId("commit-ticket");
    type("feat(ui): do the thing");
    fireEvent.click(screen.getByTestId("commit-ticket"));
    expect(messageField().value).toBe("feat(ui): PROJ-123 do the thing");
  });

  it("goes quiet once the subject already names the ticket", async () => {
    setup({ branchName: "feat/PROJ-123-commit-help" });
    await screen.findByTestId("commit-ticket");
    type("PROJ-123 already here");
    expect(screen.getByTestId<HTMLButtonElement>("commit-ticket").disabled).toBe(true);
  });

  it("offers nothing for a branch with no ticket in it", async () => {
    setup({ branchName: "feat/add-commit-help" });
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "get_commit_template")).toBe(true),
    );
    expect(screen.queryByTestId("commit-ticket")).toBeNull();
  });

  it("follows the configured pattern", async () => {
    useSettingsStore.getState().set("commitTicketPattern", "issue-(\\d+)");
    setup({ branchName: "fix/issue-42-crash" });
    const chip = await screen.findByTestId("commit-ticket");
    expect(chip.textContent).toContain("42");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONVENTIONAL TYPE PICKER
// ═════════════════════════════════════════════════════════════════════════════

describe("the conventional-commit picker", () => {
  it("composes `type: ` onto the plain-text subject", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("add a thing");
    pgPickOption(typePicker(), "feat");
    expect(messageField().value).toBe("feat: add a thing");
  });

  it("maps no native <select>, open or closed", async () => {
    setup();
    await screen.findByTestId("commit-type");
    expect(document.querySelector("select")).toBeNull();
    // Opening it is where a native control would show up.
    expect(pgSelectValues(typePicker())).toContain("feat");
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector("option")).toBeNull();
  });

  it("reads a prefix the user typed by hand, rather than ignoring it", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("fix(commit): stop the crash");
    // The picker parses the box; it does not keep its own draft.
    expect(screen.getByTestId<HTMLInputElement>("commit-type").value).toBe("fix");
    expect(screen.getByTestId<HTMLInputElement>("commit-scope").value).toBe("commit");
  });

  it("adds the scope to the subject once a type is there", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("feat: do the thing");
    fireEvent.change(screen.getByTestId("commit-scope"), { target: { value: "ui" } });
    expect(messageField().value).toBe("feat(ui): do the thing");
  });

  it("waits for a type before it will take a scope", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("do the thing");
    expect(screen.getByTestId<HTMLInputElement>("commit-scope").disabled).toBe(true);
  });

  it("leaves the body alone", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("add a thing\n\nWhy: because.");
    pgPickOption(typePicker(), "feat");
    expect(messageField().value).toBe("feat: add a thing\n\nWhy: because.");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUBJECT LENGTH — advisory, and only advisory
// ═════════════════════════════════════════════════════════════════════════════

describe("the subject-length readout", () => {
  it("counts against 72 and never blocks the commit", async () => {
    setup();
    await screen.findByTestId("commit-type");
    const long = "feat: " + "x".repeat(120);
    type(long);
    expect(screen.getByTestId("commit-subject-count").textContent).toBe(
      `${long.length}/72`,
    );
    expect(screen.getByTestId<HTMLButtonElement>("commit-button").disabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WHAT WAS ALREADY THERE
// ═════════════════════════════════════════════════════════════════════════════

describe("the composer's existing affordances still work", () => {
  it("still sends the sign-off flag", async () => {
    setup();
    await screen.findByTestId("commit-type");
    type("feat: thing");
    fireEvent.click(screen.getByLabelText("Add Signed-off-by trailer"));
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.signoff).toBe(true);
  });

  it("still appends co-author trailers after the cleaned message", async () => {
    setup();
    await screen.findByTestId("commit-type");
    // Trailing blank lines are cleaned in BOTH modes, so the trailer block
    // still joins on exactly one blank line — while the `#` line, typed by
    // hand and not seeded, stays where the user put it.
    type("feat: thing\n# a comment\n\n\n");
    fireEvent.change(screen.getByTestId("commit-coauthors"), {
      target: { value: "Ada <ada@x.com>" },
    });
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: thing\n# a comment\n\nCo-Authored-By: Ada <ada@x.com>",
    );
  });

  it("appends them after the STRIPPED message when a template seeded the box", async () => {
    setup({ template: template({ path: "/repo/.gitmessage", body: "seed\n" }) });
    await waitFor(() => expect(messageField().value).toBe("seed\n"));
    type("feat: thing\n# a comment\n\n\n");
    fireEvent.change(screen.getByTestId("commit-coauthors"), {
      target: { value: "Ada <ada@x.com>" },
    });
    fireEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(commitCall()).toBeDefined());
    expect(commitCall()!.args.message).toBe(
      "feat: thing\n\nCo-Authored-By: Ada <ada@x.com>",
    );
  });

  it("still recalls a recent message into the box", async () => {
    setup({ commits: [commit("feat: an earlier one", "With a body.")] });
    await screen.findByTestId("commit-type");
    fireEvent.click(screen.getByText("Recent"));
    fireEvent.click(await screen.findByText("feat: an earlier one"));
    expect(messageField().value).toBe("feat: an earlier one\n\nWith a body.");
  });
});
