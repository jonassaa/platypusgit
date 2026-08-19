// diffOpenReady — the one gate the four diff surfaces answer "may I scroll to the
// first change yet?" with (issue 188). Pure, so it is tested directly rather than
// through a screen: each of the three conditions it enforces is a bug that shipped
// somewhere else in this codebase first.

import { describe, it, expect } from "vitest";
import { diffOpenReady } from "./useDiffGaps";

const text = (o?: { newText?: string | null; oldText?: string | null }) => ({
  newText: o?.newText ?? null,
  oldText: o?.oldText ?? null,
});

/** The fresh, measured, chunked base case — each test perturbs one term. */
const ready = (o: Partial<Parameters<typeof diffOpenReady>[0]>) =>
  diffOpenReady({
    diffFor: "a.ts",
    showing: "a.ts",
    rowCount: 12,
    viewportH: 600,
    gaps: "fold",
    text: text(),
    ...o,
  });

describe("diffOpenReady", () => {
  it("is ready in chunked mode as soon as rows and a measured viewport are in", () => {
    expect(ready({})).toBe(true);
  });

  it("is not ready with no rows — an identical, binary or LFS diff must not scroll", () => {
    expect(ready({ rowCount: 0 })).toBe(false);
  });

  // The one only a real webview found: a file switch renders once with the
  // OUTGOING diff still in state, and auto-opening there spends the once-per-file
  // budget on a row model that is about to be replaced.
  it("is not ready while the row model still belongs to the file being left", () => {
    expect(ready({ diffFor: "a.ts", showing: "b.ts" })).toBe(false);
    // Nothing fetched yet is not "fresh" either, however the surface spells it.
    expect(ready({ diffFor: null, showing: null })).toBe(false);
    expect(ready({ diffFor: undefined, showing: undefined })).toBe(false);
  });

  it("treats an UNMEASURED viewport (0) as not ready, never as no space", () => {
    // The trap: `scrollTopForRow` no-ops on viewportH <= 0, so scrolling here
    // would silently do nothing while the cursor claimed to have moved — and
    // WebKitGTK 605 has no ResizeObserver, so 0 is the normal first reading.
    expect(ready({ viewportH: 0 })).toBe(false);
    expect(ready({ viewportH: -1 })).toBe(false);
  });

  it("waits for the file text in whole-file mode, on either side", () => {
    // Fill mode with no text degrades to fold separators, so every anchor row is
    // near the top and about to move far down once the text lands.
    expect(ready({ gaps: "fill" })).toBe(false);
    expect(ready({ gaps: "fill", text: text({ newText: "a\nb\n" }) })).toBe(true);
    // A DELETED file has only the old side, which is the side flattenDiffRows
    // falls back to — so it settles too.
    expect(ready({ gaps: "fill", text: text({ oldText: "a\nb\n" }) })).toBe(true);
  });

  it("counts empty text as text — a file can honestly be empty", () => {
    expect(ready({ gaps: "fill", text: text({ newText: "" }) })).toBe(true);
  });
});
