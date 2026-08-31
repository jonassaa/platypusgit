// Undo the last operation (#242).
//
// The reason people fear a git GUI is that a misclick is unrecoverable unless
// you already know the reflog well enough not to need the GUI. This is the
// one-keystroke answer — and the design is deliberately honest about what it
// cannot do, because an undo that silently does the wrong thing is worse than
// no undo at all.
//
// ## What an entry is
//
// A before/after pair of HEAD snapshots plus what produced them. Undo moves
// HEAD from `after` back to `before`; redo moves it forward again. That is the
// whole model: it does not replay operations backwards, it moves a ref. git
// keeps the old commits reachable through the reflog until it garbage-collects,
// so "undo a commit" costs nothing and loses nothing.
//
// ## What it deliberately does NOT cover
//
// Only operations that move HEAD, and only where moving it back is the honest
// inverse. A push is not undoable (the remote has it, and rewriting someone
// else's history is not an undo). A dropped stash is not undoable. Branch
// create/delete/rename move a ref that is not HEAD and need their own inverse,
// so they are not here yet. Rebase has its own engine and its own retained
// summary; folding it in without thinking through an interrupted plan would be
// the kind of undo that lies.
//
// Anything absent simply pushes no entry, which is the safe failure: ⌘Z then
// undoes the last thing that IS undoable, rather than appearing to undo
// something it cannot.

/** The operations that push an entry. */
export type UndoKind =
  | "commit"
  | "checkout"
  | "merge"
  | "cherryPick"
  | "revert"
  | "reset";

/**
 * The kinds whose undo is a hard reset, and therefore discards uncommitted
 * work if there is any.
 *
 * These get the clean-tree precondition and a confirmation. `checkout` is the
 * one that does not: switching back to where you were keeps your changes, the
 * same way switching away did.
 */
export const HARD_KINDS: ReadonlySet<UndoKind> = new Set<UndoKind>([
  "commit",
  "merge",
  "cherryPick",
  "revert",
  "reset",
]);

/** Where HEAD was. */
export interface HeadSnapshot {
  /** The branch HEAD pointed at, or null when detached. */
  ref: string | null;
  oid: string;
}

export interface UndoEntry {
  /** Stable across renders; the palette and the tests key on it. */
  id: string;
  kind: UndoKind;
  /**
   * What the operation was, in the words the user saw — "merge of `feat/x`",
   * not "merge". The issue is explicit that ⌘Z must never appear as a bare
   * "Undo": the whole point is knowing what is about to happen.
   */
  label: string;
  before: HeadSnapshot;
  after: HeadSnapshot;
}

/**
 * How many entries are kept.
 *
 * Bounded because the stack is per-repository and lives for the session, and
 * because an undo of something you did two hundred operations ago is not an
 * undo — it is a reset to an old commit, which the reflog view already does
 * better and with more context.
 */
export const UNDO_LIMIT = 50;

/** The stack and where in it we are. Both live in `RepoSlice`. */
export interface UndoState {
  /** Oldest first. */
  undoStack: UndoEntry[];
  /**
   * How many entries are still "done" — the index of the next entry to undo.
   * Equal to `undoStack.length` when nothing has been undone.
   */
  undoCursor: number;
}

export const emptyUndo = (): UndoState => ({ undoStack: [], undoCursor: 0 });

/** The entry ⌘Z would undo, or null. */
export function undoable(s: UndoState): UndoEntry | null {
  return s.undoCursor > 0 ? (s.undoStack[s.undoCursor - 1] ?? null) : null;
}

/** The entry ⌘⇧Z would redo, or null. */
export function redoable(s: UndoState): UndoEntry | null {
  return s.undoCursor < s.undoStack.length
    ? (s.undoStack[s.undoCursor] ?? null)
    : null;
}

/**
 * Record a new operation.
 *
 * Truncates anything that was undone, which is what every undo stack does and
 * what users expect: once you undo a merge and then commit something else, the
 * merge is no longer ahead of you on the timeline. Trimming is from the OLD
 * end, so the cursor stays meaningful.
 *
 * An operation that did not actually move HEAD pushes nothing. That is not an
 * optimisation — a no-op entry would make ⌘Z appear to do something and then
 * do nothing, which is exactly the behaviour that makes people distrust undo.
 */
export function pushUndo(
  s: UndoState,
  entry: UndoEntry,
  limit = UNDO_LIMIT,
): UndoState {
  if (entry.before.oid === entry.after.oid && entry.before.ref === entry.after.ref) {
    return s;
  }
  const kept = s.undoStack.slice(0, s.undoCursor);
  kept.push(entry);
  const overflow = Math.max(0, kept.length - limit);
  const undoStack = overflow > 0 ? kept.slice(overflow) : kept;
  return { undoStack, undoCursor: undoStack.length };
}

/** Which way an entry is being applied. */
export type UndoDirection = "undo" | "redo";

/** Where an entry sends HEAD when applied in `direction`. */
export function targetOf(entry: UndoEntry, direction: UndoDirection): HeadSnapshot {
  return direction === "undo" ? entry.before : entry.after;
}

/** Where HEAD must still be for an entry to be applicable in `direction`. */
export function expectedOf(
  entry: UndoEntry,
  direction: UndoDirection,
): HeadSnapshot {
  return direction === "undo" ? entry.after : entry.before;
}

/** The state of the world an undo is checked against. */
export interface UndoWorld {
  /** HEAD's oid right now, straight from the backend. Never from the log. */
  headOid: string | null;
  /** Whether the working copy has changes — also straight from the backend. */
  dirty: boolean;
}

export type UndoCheck =
  | { ok: true; entry: UndoEntry; direction: UndoDirection; target: HeadSnapshot }
  | { ok: false; reason: string };

/**
 * Whether an entry can still be applied, and why not when it cannot.
 *
 * **Refuses rather than guesses.** If the world moved, the recorded `before`
 * is no longer the state this operation started from, and resetting to it
 * would throw away whatever happened since — under a keystroke the user reads
 * as "put it back".
 *
 * The refusals name the operation, because "cannot undo" with no subject is
 * the same dead end as a bare "Undo".
 */
export function checkUndo(
  entry: UndoEntry | null,
  direction: UndoDirection,
  world: UndoWorld,
): UndoCheck {
  if (!entry) {
    return { ok: false, reason: "There is nothing to undo." };
  }
  const expected = expectedOf(entry, direction);
  if (world.headOid !== expected.oid) {
    return {
      ok: false,
      reason: `HEAD has moved since that ${entry.label} — ${
        direction === "undo" ? "undoing" : "redoing"
      } it would discard what happened after it. Use the reflog to go back deliberately.`,
    };
  }
  if (HARD_KINDS.has(entry.kind) && world.dirty) {
    return {
      ok: false,
      reason: `The working copy has changed since that ${entry.label}. Undoing it resets the working copy, which would discard those changes — commit or stash them first.`,
    };
  }
  return { ok: true, entry, direction, target: targetOf(entry, direction) };
}

/**
 * The menu/palette label. Names the operation, never a bare "Undo".
 */
export function describeUndo(
  entry: UndoEntry | null,
  direction: UndoDirection,
): string {
  const verb = direction === "undo" ? "Undo" : "Redo";
  return entry ? `${verb} ${entry.label}` : `${verb}`;
}

/**
 * Whether applying this entry needs a confirmation.
 *
 * A hard reset can only discard uncommitted work when there is some — and
 * `checkUndo` already refuses that case outright. What the confirmation is
 * really for is the commit that is about to stop being on a branch: it stays
 * in the reflog, but "your commit is now only reachable from the reflog" is
 * not something to do to someone silently.
 */
export function needsConfirm(entry: UndoEntry): boolean {
  return HARD_KINDS.has(entry.kind);
}

/** An oid as the UI shows it. Undo labels name commits, and a full sha is noise. */
export function shortOid(oid: string): string {
  return oid.length > 8 ? oid.slice(0, 8) : oid;
}

/**
 * A commit's subject, quoted for a label, truncated.
 *
 * The label ends up inside a sentence ("Undo commit “fix: thing”?"), so a long
 * message would push the actual verb off the end of a menu row.
 */
export function quoteSubject(message: string, max = 40): string {
  const subject = message.split("\n", 1)[0]?.trim() ?? "";
  if (!subject) return "";
  const cut = subject.length > max ? `${subject.slice(0, max - 1)}…` : subject;
  return `\u201c${cut}\u201d`;
}
