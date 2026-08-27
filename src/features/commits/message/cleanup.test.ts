// git's message cleanup, ported — and, more importantly, WHICH cleanup.
//
// Every expectation here was checked against real `git commit` (2.50) across
// all five `--cleanup` modes, both `-m` and a scripted editor. That is the only
// way to be sure, because the rules are not the obvious ones:
//
//   * `default` is context-sensitive. `git commit -m "#123 fix"` commits
//     `#123 fix`; comments are stripped only when the message went through the
//     editor. Our stand-in for "went through the editor" is `fromTemplate`.
//   * a comment line is one whose FIRST character is the comment prefix.
//     `  # indented` is NOT a comment and git commits it.
//   * a `#` in the middle of a line is ordinary text.
//   * the whitespace half applies in every mode but `verbatim`, `-m` included:
//     trailing whitespace goes, runs of blank lines collapse to one, and
//     leading/trailing blank lines vanish.
//   * a comment line does not itself count as a blank line, so removing one
//     from between two paragraphs does not open a gap.
//   * scissors cuts in the EDITOR path only.
import { describe, it, expect } from "vitest";
import {
  cleanupCommitMessage,
  commentLineCount,
  stripsComments,
} from "./cleanup";

/** The editor-path context: the box was seeded from `commit.template`. */
const SEEDED = { fromTemplate: true } as const;

describe("which cleanup applies", () => {
  it("keeps comments for a message the user typed — this is `git commit -m`", () => {
    // The whole point of scoping this. `#123` is an ordinary subject and a
    // forge renders it as an issue link; stripping it would silently delete
    // the user's words.
    expect(cleanupCommitMessage("#123 fix the thing")).toBe("#123 fix the thing");
    expect(stripsComments({})).toBe(false);
  });

  it("strips comments once the box came from commit.template", () => {
    expect(cleanupCommitMessage("subject\n# a hint\n", SEEDED)).toBe("subject");
    expect(stripsComments(SEEDED)).toBe(true);
  });

  it("honours an explicit commit.cleanup over the context either way", () => {
    expect(cleanupCommitMessage("subject\n# a hint\n", { mode: "strip" })).toBe(
      "subject",
    );
    expect(
      cleanupCommitMessage("subject\n# a hint\n", { ...SEEDED, mode: "whitespace" }),
    ).toBe("subject\n# a hint");
    expect(stripsComments({ mode: "strip" })).toBe(true);
    expect(stripsComments({ ...SEEDED, mode: "whitespace" })).toBe(false);
  });

  it("keeps comments, blank runs and trailing spaces in verbatim", () => {
    const msg = "subject   \n\n\n\n# a comment\n\n\n";
    // Only the terminating newline goes, which is this module's one deviation
    // from git and applies in every mode — `buildMessage` trims the end on the
    // way out anyway, so nothing observable changes.
    const kept = "subject   \n\n\n\n# a comment";
    expect(cleanupCommitMessage(msg, { mode: "verbatim" })).toBe(kept);
    expect(cleanupCommitMessage(msg, { ...SEEDED, mode: "verbatim" })).toBe(kept);
  });
});

describe("the comment rule, where it applies", () => {
  it("drops a line that starts with the comment prefix", () => {
    expect(
      cleanupCommitMessage("feat: thing\n\n# please explain why\n", SEEDED),
    ).toBe("feat: thing");
  });

  it("keeps a # that is not the first character of the line", () => {
    // Stripping too much is as wrong as stripping too little.
    expect(
      cleanupCommitMessage("fix: crash\n\nCloses the #123 report\n", SEEDED),
    ).toBe("fix: crash\n\nCloses the #123 report");
  });

  it("keeps an INDENTED comment line, exactly as git does", () => {
    expect(cleanupCommitMessage("subject\n\n  # indented hash\n", SEEDED)).toBe(
      "subject\n\n  # indented hash",
    );
  });

  it("drops a subject that IS a comment — which is how git empties a message", () => {
    expect(cleanupCommitMessage("#123 this is a comment line\n", SEEDED)).toBe("");
  });

  it("honours a different comment prefix", () => {
    expect(
      cleanupCommitMessage("subject\n; a hint\n#123 kept\n", {
        ...SEEDED,
        commentPrefix: ";",
      }),
    ).toBe("subject\n#123 kept");
  });

  it("honours a multi-character prefix (git 2.45 widened commentChar)", () => {
    expect(
      cleanupCommitMessage("subject\n// a hint\n", {
        ...SEEDED,
        commentPrefix: "//",
      }),
    ).toBe("subject");
  });

  it("falls back to # for an empty prefix rather than stripping everything", () => {
    expect(
      cleanupCommitMessage("subject\n# hint\n", { ...SEEDED, commentPrefix: "" }),
    ).toBe("subject");
  });

  it("does not open a gap where a comment line used to be", () => {
    // git's stripspace `continue`s past a comment WITHOUT counting it as an
    // empty line, so two adjacent paragraphs stay adjacent.
    expect(cleanupCommitMessage("line one\n# a note\nline two", SEEDED)).toBe(
      "line one\nline two",
    );
  });

  it("reduces an all-comment message to nothing", () => {
    expect(cleanupCommitMessage("# one\n# two\n\n# three\n", SEEDED)).toBe("");
  });
});

describe("the whitespace rules — every mode but verbatim, -m included", () => {
  it("trims trailing whitespace from every line", () => {
    expect(cleanupCommitMessage("subject   \n\nbody\t\n")).toBe("subject\n\nbody");
  });

  it("collapses a run of blank lines to one", () => {
    expect(cleanupCommitMessage("subject\n\n\n\nbody\n")).toBe("subject\n\nbody");
  });

  it("drops leading and trailing blank lines", () => {
    expect(cleanupCommitMessage("\n\n\nsubject\n\n\n")).toBe("subject");
  });

  it("treats a whitespace-only line as blank", () => {
    expect(cleanupCommitMessage("subject\n   \n   \nbody")).toBe("subject\n\nbody");
  });

  it("leaves an already-clean message byte-for-byte alone", () => {
    const msg = "feat: thing\n\nWhy: because.\nAlso: this.";
    expect(cleanupCommitMessage(msg)).toBe(msg);
    expect(cleanupCommitMessage(msg, SEEDED)).toBe(msg);
  });

  it("still applies when comments are being kept", () => {
    expect(cleanupCommitMessage("#123 subject   \n\n\n\nbody\n")).toBe(
      "#123 subject\n\nbody",
    );
  });
});

describe("scissors", () => {
  const MSG =
    "subject\n# a comment\nbody\n\n# ------------------------ >8 ------------------------\ncut me\n";

  it("cuts at the scissors line in the editor path", () => {
    expect(cleanupCommitMessage(MSG, { ...SEEDED, mode: "scissors" })).toBe(
      "subject\n# a comment\nbody",
    );
  });

  it("does NOT cut for a message the user typed — matching `-m`", () => {
    // Verified: `git commit --cleanup=scissors -m …` leaves the line alone.
    expect(cleanupCommitMessage(MSG, { mode: "scissors" })).toBe(
      "subject\n# a comment\nbody\n\n# ------------------------ >8 ------------------------\ncut me",
    );
  });

  it("empties a message that opens with the scissors line", () => {
    expect(
      cleanupCommitMessage(
        "# ------------------------ >8 ------------------------\nall of it\n",
        { ...SEEDED, mode: "scissors" },
      ),
    ).toBe("");
  });

  it("needs the marker to end a line, as git does", () => {
    const noNewline =
      "subject\n# ------------------------ >8 ------------------------";
    expect(cleanupCommitMessage(noNewline, { ...SEEDED, mode: "scissors" })).toBe(
      noNewline,
    );
  });

  it("uses the repository's comment prefix for the marker", () => {
    expect(
      cleanupCommitMessage(
        "subject\n; ------------------------ >8 ------------------------\ncut\n",
        { ...SEEDED, mode: "scissors", commentPrefix: ";" },
      ),
    ).toBe("subject");
  });
});

describe("commentLineCount", () => {
  it("counts what a strip cleanup would silently drop", () => {
    expect(commentLineCount("subject\n# a\n# b\nbody\n")).toBe(2);
  });

  it("counts nothing when nothing would be dropped", () => {
    expect(commentLineCount("subject\n\nrefs #12\n")).toBe(0);
  });

  it("uses the repository's own prefix", () => {
    expect(commentLineCount("subject\n; a\n# b\n", ";")).toBe(1);
  });
});
