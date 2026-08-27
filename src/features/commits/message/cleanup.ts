// git's own commit-message cleanup, ported (#252) — including WHICH cleanup.
//
// git has five cleanup modes and the default one is context-sensitive:
//
//   verbatim    nothing is touched.
//   whitespace  trailing whitespace goes, blank runs collapse, leading and
//               trailing blanks go. Comment lines are KEPT.
//   strip       whitespace, plus every comment line removed.
//   scissors    whitespace, plus — in the editor path only — everything from
//               the scissors line down is cut.
//   default     `strip` if the message is to be EDITED, `whitespace` otherwise.
//
// That last line is the whole subtlety. `git commit -m "#123 fix the thing"`
// commits `#123 fix the thing`: comments are stripped only when the message
// passed through the editor, which is the only context where git (or a
// template) put `#` lines into the buffer unasked.
//
// Our textarea is much closer to `-m` than to the editor — we never append
// status comments — EXCEPT when `commit.template` has just seeded it. That is
// exactly the editor's situation, and those comments must go. So one flag,
// `fromTemplate`, stands in for git's "is the message to be edited", and it
// drives both halves: what `default` means, and whether `scissors` cuts.
//
// This is the frontend's copy on purpose: the composer shows what will be
// removed BEFORE anyone presses Commit, and gates the Commit button on the
// CLEANED text, so a message that is nothing but comments cannot become an
// empty commit message. One implementation serves the preview and the send.
//
// Every rule below was checked against real `git commit` (2.50) — all five
// modes, `-m` and a scripted editor — rather than read off the documentation.

// ONE definition of the mode set, at the IPC boundary where it mirrors the Rust
// enum — re-exported rather than restated, so the two cannot drift apart.
import type { CleanupMode } from "@/lib/types";

export type { CleanupMode };

/** git's default, and what `core.commentChar` falls back to. */
export const DEFAULT_COMMENT_PREFIX = "#";

/** The line `--cleanup=scissors` cuts at, after the comment prefix and a space. */
const SCISSORS = "------------------------ >8 ------------------------";

/**
 * Every character C's `isspace()` treats as whitespace, which is what git's
 * per-line trim uses. Deliberately NOT `\s`: JavaScript's `\s` also matches
 * NBSP and the Unicode spaces, and trimming those would remove bytes git keeps.
 */
const TRAILING_WS = /[ \t\r\f\v]+$/;

export interface CleanupSpec {
  /** `commit.cleanup`. Defaults to git's own default. */
  mode?: CleanupMode;
  /** `core.commentChar`, already resolved (`auto` included). */
  commentPrefix?: string;
  /**
   * Whether the text in the box came from `commit.template`.
   *
   * This is our stand-in for git's "the message is to be edited": it is true in
   * exactly the case where comment lines arrived in the buffer without the user
   * putting them there. A message the user typed themselves is treated like
   * `git commit -m`, so a `#123 fix the thing` subject survives.
   */
  fromTemplate?: boolean;
}

/** `default` resolved against the context; every other mode passes through. */
function resolveMode(spec: CleanupSpec): Exclude<CleanupMode, "default"> {
  const mode = spec.mode ?? "default";
  if (mode !== "default") return mode;
  return spec.fromTemplate ? "strip" : "whitespace";
}

/**
 * Whether this cleanup will remove comment lines — what the composer's advisory
 * and its empty-message check both key on.
 */
export function stripsComments(spec: CleanupSpec = {}): boolean {
  return resolveMode(spec) === "strip";
}

/**
 * The message git would actually store, given this text and this context.
 *
 * The whitespace half is faithful to `strbuf_stripspace()`:
 *   - each surviving line loses its trailing whitespace;
 *   - runs of blank lines collapse to one; leading and trailing blanks go.
 *
 * The comment half (mode `strip` only):
 *   - a line whose FIRST character begins `commentPrefix` is removed entirely.
 *     Leading whitespace disqualifies it — git commits `  # indented`, and so
 *     do we — and a `#` anywhere but position 0 is ordinary text;
 *   - a removed comment line is not counted as a blank line, so deleting one
 *     from between two paragraphs does not open a gap.
 *
 * The one deviation from git: git terminates a non-empty result with a newline.
 * We do not, because the backend stores the message verbatim and every other
 * producer in the composer (`buildMessage`'s `trimEnd`, the trailer block)
 * already works in unterminated text — adding one here would change the bytes
 * of every commit the app writes without changing what anybody reads.
 */
export function cleanupCommitMessage(text: string, spec: CleanupSpec = {}): string {
  const prefix = spec.commentPrefix || DEFAULT_COMMENT_PREFIX;
  const mode = resolveMode(spec);
  // Verbatim keeps every comment, every blank run and every trailing space —
  // only the terminating newline goes, so the "no trailing newline" deviation
  // below holds in EVERY mode rather than in four of five. Costs nothing:
  // `buildMessage` trims the end of the message on the way out regardless.
  if (mode === "verbatim") return text.replace(/\n+$/, "");
  // Scissors cuts in the EDITOR path only — verified: `git commit --cleanup=
  // scissors -m …` leaves a scissors line in the message untouched. Our
  // editor-path equivalent is a buffer that came from the template.
  const body =
    mode === "scissors" && spec.fromTemplate ? truncateAtScissors(text, prefix) : text;
  return stripspace(body, mode === "strip" ? prefix : null);
}

/** How many lines a `strip` cleanup would drop as comments. */
export function commentLineCount(
  text: string,
  commentPrefix: string = DEFAULT_COMMENT_PREFIX,
): number {
  const prefix = commentPrefix || DEFAULT_COMMENT_PREFIX;
  let n = 0;
  for (const line of text.split("\n")) if (line.startsWith(prefix)) n += 1;
  return n;
}

/** `strbuf_stripspace()`. A null `commentPrefix` keeps comment lines. */
function stripspace(text: string, commentPrefix: string | null): string {
  const out: string[] = [];
  let pendingBlank = false;
  for (const raw of text.split("\n")) {
    if (commentPrefix !== null && raw.startsWith(commentPrefix)) continue;
    const line = raw.replace(TRAILING_WS, "");
    if (line === "") {
      // Blank lines before anything has been emitted are dropped outright;
      // otherwise one blank is held back and flushed if more text follows.
      pendingBlank = out.length > 0;
      continue;
    }
    if (pendingBlank) out.push("");
    pendingBlank = false;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * `wt_status_locate_end()`: cut at the first `<prefix> ---…--- >8 ---…---`
 * line, keeping everything above it.
 *
 * The marker has to be followed by a newline — a scissors line at the very end
 * with nothing after it is not one, which is git's rule and not an oversight.
 */
function truncateAtScissors(text: string, prefix: string): string {
  const marker = `${prefix} ${SCISSORS}\n`;
  if (text.startsWith(marker)) return "";
  const at = text.indexOf(`\n${marker}`);
  return at === -1 ? text : text.slice(0, at + 1);
}
