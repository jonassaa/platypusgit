// mergeModel — pure diff3 chunking for the merge resolver window.
// diff3Merge(ours, base, theirs) over LINE ARRAYS; `ok` regions are
// auto-applied into the initial result, `conflict` regions are filled with
// base lines and tracked as char-offset regions for the editor to own.

import { diff3Merge } from "node-diff3";
import type { ConflictSides } from "@/lib/types";

export type ChunkResolution = "ours" | "theirs" | "both" | "manual";

export interface ConflictRegion {
  id: number;
  ours: { start: number; lines: string[] };
  base: { start: number; lines: string[] };
  theirs: { start: number; lines: string[] };
}

export interface ResultRegion {
  id: number;
  from: number;
  to: number;
}

export interface MergeModel {
  oursLines: string[];
  theirsLines: string[];
  conflicts: ConflictRegion[];
  initialResult: string;
  resultRegions: ResultRegion[];
  trailingNewline: boolean;
  /** Line ending to reattach on Apply. CM strips \r on load, so the model
   *  works in LF space; this records the file's original eol so applyFile can
   *  write it back unchanged (a Windows .msi ships CRLF by default). */
  eol: "\n" | "\r\n";
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  // Strip a single trailing CR: CRLF text splits on "\n" leaving each line
  // with a dangling "\r". CodeMirror normalizes \r\n?|\n → \n on load, so if
  // we kept the \r the model's char offsets would count chars CM strips,
  // overrunning the doc (RangeError on accept) and silently converting EOL.
  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export function buildMergeModel(sides: ConflictSides): MergeModel | null {
  if (sides.binary || sides.ours == null || sides.theirs == null) return null;
  const oursLines = splitLines(sides.ours);
  const theirsLines = splitLines(sides.theirs);
  const baseLines = splitLines(sides.base ?? "");

  const regions = diff3Merge(oursLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });

  const resultLines: string[] = [];
  const conflicts: ConflictRegion[] = [];
  // line-index boundaries first; converted to char offsets at the end
  const lineRegions: Array<{ id: number; startLine: number; lineCount: number }> = [];

  for (const region of regions) {
    if (region.ok) {
      resultLines.push(...region.ok);
    } else if (region.conflict) {
      const c = region.conflict;
      const id = conflicts.length;
      conflicts.push({
        id,
        ours: { start: c.aIndex, lines: c.a },
        base: { start: c.oIndex, lines: c.o },
        theirs: { start: c.bIndex, lines: c.b },
      });
      lineRegions.push({ id, startLine: resultLines.length, lineCount: c.o.length });
      resultLines.push(...c.o);
    }
  }

  const initialResult = resultLines.join("\n");
  const offsetOfLine = (i: number): number => {
    let off = 0;
    for (let l = 0; l < i; l++) off += resultLines[l].length + 1;
    return off;
  };
  const resultRegions: ResultRegion[] = lineRegions.map((r) => {
    const from = offsetOfLine(r.startLine);
    const to =
      r.lineCount === 0
        ? from
        : from +
          resultLines
            .slice(r.startLine, r.startLine + r.lineCount)
            .join("\n").length;
    return { id: r.id, from, to };
  });

  // Detect trailing-newline + eol from the same source (ours if non-empty,
  // else theirs, else base) so both reflect the file we'll write back.
  const eolSource =
    sides.ours !== "" ? sides.ours : sides.theirs !== "" ? sides.theirs : (sides.base ?? "");
  const trailingNewline = eolSource.endsWith("\n");
  const eol: "\n" | "\r\n" = eolSource.includes("\r\n") ? "\r\n" : "\n";

  return { oursLines, theirsLines, conflicts, initialResult, resultRegions, trailingNewline, eol };
}

export function resolutionLines(
  c: ConflictRegion,
  res: "ours" | "theirs" | "both",
): string[] {
  if (res === "ours") return c.ours.lines;
  if (res === "theirs") return c.theirs.lines;
  return [...c.ours.lines, ...c.theirs.lines];
}
