// Clipboard text for a diff, built from the MODEL rather than the DOM.
//
// Why this exists at all: every diff surface is windowed, so only about a
// screenful of rows is in the document at any moment. A mouse selection
// therefore cannot reach past the rendered window — drag far enough and the
// anchor row unmounts and the selection collapses. These builders are what
// `diff.copy` and the diff context menu use to put an arbitrarily long range on
// the clipboard regardless of what is on screen.
//
// Both functions normalise line endings themselves: `DiffLine.content` is git's
// raw line, so it usually carries a trailing "\n" but does NOT for a file with
// no newline at EOF. Stripping and re-joining is the only way to get a
// predictable result out of both.
import { isFileContent } from "./diffRows";
import type { FileDiff } from "./types";

/** git's raw line, minus the trailing newline it usually carries. */
function bare(content: string): string {
  return content.replace(/\r?\n$/, "");
}

/**
 * The whole file's diff as patch-shaped text: each hunk's `@@` header, then its
 * lines under the usual ` `/`-`/`+` prefixes.
 *
 * `isFileContent` — shared with the row model — is what keeps the `@@` range
 * from being printed twice. The commit-diff builder leaves libgit2's
 * `HunkHeader` line inside `hunks[].lines`, and as a non-add/rem kind it would
 * otherwise come out space-prefixed directly under the real header.
 *
 * No trailing newline: these builders promise "the lines, newline-separated",
 * and one rule for both of them beats a special case per caller.
 */
export function fileDiffToText(diff: FileDiff): string {
  const out: string[] = [];
  for (const h of diff.hunks) {
    out.push(h.header);
    for (const l of h.lines) {
      if (!isFileContent(l)) continue;
      const k = l.kind.kind;
      const prefix = k === "Addition" ? "+" : k === "Deletion" ? "-" : " ";
      out.push(`${prefix}${bare(l.content)}`);
    }
  }
  return out.join("\n");
}

/**
 * Just the selected changed lines, as bare code — no `+`/`-` prefix and no line
 * numbers, so the result pastes into a source file as-is. That is the same
 * promise the on-screen selection makes, where the gutters are `user-select:
 * none`.
 *
 * `sel` is keyed the way `CommitPanel`'s `lineSel` is: hunk index → the
 * `changedIndex` values selected in it. `changedIndex` counts add/rem lines only,
 * per hunk, after `isFileContent` has dropped the header — reproduced here
 * through the same predicate rather than re-derived, because a numbering that
 * drifts from the row model's would copy the line below the one the reader
 * clicked.
 *
 * Output order is hunk order, then `changedIndex` order, whatever order the
 * caller's arrays happen to be in: a shift-click range and a set of scattered
 * ctrl-clicks should paste as the file reads.
 */
export function selectedLinesToText(
  diff: FileDiff,
  sel: Record<number, number[]>,
): string {
  const out: string[] = [];
  for (let hunkIndex = 0; hunkIndex < diff.hunks.length; hunkIndex++) {
    const want = sel[hunkIndex];
    if (!want || want.length === 0) continue;
    const wanted = new Set(want);
    let changedIndex = 0;
    for (const l of diff.hunks[hunkIndex].lines) {
      if (!isFileContent(l)) continue;
      const k = l.kind.kind;
      if (k !== "Addition" && k !== "Deletion") continue;
      if (wanted.has(changedIndex)) out.push(bare(l.content));
      changedIndex++;
    }
  }
  return out.join("\n");
}
