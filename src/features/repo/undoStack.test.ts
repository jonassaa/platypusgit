// The undo model (#242).
//
// An undo that silently does the wrong thing is worse than no undo, so most of
// this file is about REFUSING: the world moved, the tree is dirty, there is
// nothing to undo. The happy path is one line; the honesty is the feature.

import { describe, expect, it } from "vitest";

import {
  HARD_KINDS,
  UNDO_LIMIT,
  checkUndo,
  describeUndo,
  emptyUndo,
  expectedOf,
  needsConfirm,
  pushUndo,
  quoteSubject,
  redoable,
  shortOid,
  targetOf,
  undoable,
  type UndoEntry,
  type UndoKind,
  type UndoState,
} from "./undoStack";

let seq = 0;
const entry = (over: Partial<UndoEntry> = {}): UndoEntry => ({
  id: `e${++seq}`,
  kind: "commit",
  label: 'commit "fix: thing"',
  before: { ref: "refs/heads/main", oid: "aaaa1111" },
  after: { ref: "refs/heads/main", oid: "bbbb2222" },
  ...over,
});

const stateWith = (...entries: UndoEntry[]): UndoState =>
  entries.reduce((s, e) => pushUndo(s, e), emptyUndo());

describe("recording operations", () => {
  it("starts empty", () => {
    const s = emptyUndo();
    expect(undoable(s)).toBeNull();
    expect(redoable(s)).toBeNull();
  });

  it("makes the newest operation the one to undo", () => {
    const a = entry({ label: "merge of feat/x" });
    const b = entry({
      label: "commit “second”",
      before: a.after,
      after: { ref: "refs/heads/main", oid: "cccc3333" },
    });
    const s = stateWith(a, b);
    expect(undoable(s)?.label).toBe("commit “second”");
  });

  it("records nothing when HEAD did not actually move", () => {
    // Checking out the branch you are already on. An entry here would make ⌘Z
    // appear to do something and then do nothing — the behaviour that makes
    // people stop trusting undo.
    const s = pushUndo(
      emptyUndo(),
      entry({
        kind: "checkout",
        before: { ref: "refs/heads/main", oid: "aaaa1111" },
        after: { ref: "refs/heads/main", oid: "aaaa1111" },
      }),
    );
    expect(s.undoStack).toHaveLength(0);
  });

  it("records a detach even though the commit is the same", () => {
    // Same oid, different ref: `main` vs detached at main's tip is a real
    // state change, and undoing it has to put you back ON the branch.
    const s = pushUndo(
      emptyUndo(),
      entry({
        kind: "checkout",
        before: { ref: "refs/heads/main", oid: "aaaa1111" },
        after: { ref: null, oid: "aaaa1111" },
      }),
    );
    expect(s.undoStack).toHaveLength(1);
  });

  it("is bounded, dropping the OLDEST", () => {
    let s = emptyUndo();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      s = pushUndo(
        s,
        entry({ label: `op ${i}`, after: { ref: "refs/heads/main", oid: `oid${i}` } }),
      );
    }
    expect(s.undoStack).toHaveLength(UNDO_LIMIT);
    expect(s.undoStack[0]?.label).toBe("op 5");
    expect(undoable(s)?.label).toBe(`op ${UNDO_LIMIT + 4}`);
    // The cursor stays meaningful after trimming — trimming from the old end
    // is what makes that true.
    expect(s.undoCursor).toBe(UNDO_LIMIT);
  });
});

describe("the cursor", () => {
  it("moves back and forth without losing entries", () => {
    const a = entry({ label: "first" });
    const b = entry({ label: "second", before: a.after, after: { ref: "refs/heads/main", oid: "cccc3333" } });
    let s = stateWith(a, b);

    expect(undoable(s)?.label).toBe("second");
    s = { ...s, undoCursor: s.undoCursor - 1 };
    expect(undoable(s)?.label).toBe("first");
    expect(redoable(s)?.label).toBe("second");

    s = { ...s, undoCursor: 0 };
    expect(undoable(s)).toBeNull();
    expect(redoable(s)?.label).toBe("first");
  });

  it("a new operation discards what was undone", () => {
    // Once you undo a merge and then commit something else, the merge is no
    // longer ahead of you on the timeline — every undo stack works this way.
    const a = entry({ label: "first" });
    const b = entry({ label: "second", after: { ref: "refs/heads/main", oid: "cccc3333" } });
    let s = stateWith(a, b);
    s = { ...s, undoCursor: 1 }; // "second" undone
    s = pushUndo(s, entry({ label: "third", after: { ref: "refs/heads/main", oid: "dddd4444" } }));

    expect(s.undoStack.map((e) => e.label)).toEqual(["first", "third"]);
    expect(redoable(s)).toBeNull();
  });
});

describe("which end of the entry is used", () => {
  it("undo goes back to before and expects to still be at after", () => {
    const e = entry();
    expect(targetOf(e, "undo")).toEqual(e.before);
    expect(expectedOf(e, "undo")).toEqual(e.after);
  });

  it("redo goes forward to after and expects to still be at before", () => {
    const e = entry();
    expect(targetOf(e, "redo")).toEqual(e.after);
    expect(expectedOf(e, "redo")).toEqual(e.before);
  });
});

describe("preconditions", () => {
  const clean = { headOid: "bbbb2222", dirty: false };

  it("allows an undo when the world has not moved", () => {
    const check = checkUndo(entry(), "undo", clean);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.target.oid).toBe("aaaa1111");
  });

  it("refuses when HEAD has moved since the operation", () => {
    // The recorded `before` is no longer the state this operation started
    // from, so resetting to it would discard whatever happened since — under
    // a keystroke the user reads as "put it back".
    const check = checkUndo(entry(), "undo", { headOid: "9999", dirty: false });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("HEAD has moved");
      // Names the operation, and points at the tool that CAN go back.
      expect(check.reason).toContain('commit "fix: thing"');
      expect(check.reason).toContain("reflog");
    }
  });

  it("refuses a hard undo when the working copy is dirty", () => {
    const check = checkUndo(entry(), "undo", { headOid: "bbbb2222", dirty: true });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("working copy has changed");
      expect(check.reason).toContain("stash");
    }
  });

  it("allows a dirty undo of a CHECKOUT", () => {
    // Switching back to where you were keeps your changes, exactly the way
    // switching away did. Refusing here would be a rule with no reason.
    const check = checkUndo(
      entry({ kind: "checkout", label: "switch to feat/x" }),
      "undo",
      { headOid: "bbbb2222", dirty: true },
    );
    expect(check.ok).toBe(true);
  });

  it("refuses when there is no entry", () => {
    const check = checkUndo(null, "undo", clean);
    expect(check.ok).toBe(false);
  });

  it("checks redo against the OTHER end", () => {
    const e = entry();
    // Sitting at `before` (the undone state) is what makes a redo valid...
    expect(checkUndo(e, "redo", { headOid: "aaaa1111", dirty: false }).ok).toBe(true);
    // ...and sitting at `after` is what makes it invalid.
    expect(checkUndo(e, "redo", { headOid: "bbbb2222", dirty: false }).ok).toBe(false);
  });

  it("refuses an unborn HEAD rather than treating it as a match", () => {
    expect(checkUndo(entry(), "undo", { headOid: null, dirty: false }).ok).toBe(false);
  });
});

describe("what needs a confirmation", () => {
  it("every hard kind does", () => {
    for (const kind of HARD_KINDS) {
      expect(needsConfirm(entry({ kind }))).toBe(true);
    }
  });

  it("a checkout does not — it discards nothing", () => {
    expect(needsConfirm(entry({ kind: "checkout" }))).toBe(false);
  });

  it("every kind is either hard or checkout, with nothing unclassified", () => {
    // Guards a future kind being added to the union and quietly inheriting
    // "no confirmation needed".
    const all: UndoKind[] = [
      "commit",
      "checkout",
      "merge",
      "cherryPick",
      "revert",
      "reset",
    ];
    for (const kind of all) {
      expect(needsConfirm(entry({ kind }))).toBe(kind !== "checkout");
    }
  });
});

describe("labels", () => {
  it("never renders a bare Undo when there is something to undo", () => {
    expect(describeUndo(entry({ label: "merge of feat/x" }), "undo")).toBe(
      "Undo merge of feat/x",
    );
    expect(describeUndo(entry({ label: "merge of feat/x" }), "redo")).toBe(
      "Redo merge of feat/x",
    );
  });

  it("shortens an oid the way the UI shows one", () => {
    expect(shortOid("0123456789abcdef")).toBe("01234567");
    expect(shortOid("abc")).toBe("abc");
  });

  it("quotes a commit subject and drops the body", () => {
    expect(quoteSubject("fix: thing\n\nlonger body")).toBe("“fix: thing”");
  });

  it("truncates a long subject so the verb stays visible in a menu row", () => {
    const out = quoteSubject("x".repeat(80));
    expect(out.length).toBeLessThanOrEqual(42);
    expect(out).toContain("…");
  });

  it("is empty for an empty message rather than a pair of empty quotes", () => {
    expect(quoteSubject("")).toBe("");
    expect(quoteSubject("   \n  ")).toBe("");
  });
});
