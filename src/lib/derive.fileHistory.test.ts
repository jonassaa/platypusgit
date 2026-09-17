// What a bounded file-history list admits to (#474).
//
// Three stops, three different claims, and the whole reason `HistoryStop`
// exists: "this is the file's complete history", "this list is full", and "the
// search gave up before history did" look identical on screen — a list that
// ends — and only the first one is the whole answer. The third is the one the
// issue is about: before the visit cap, a file with fewer changes than the
// limit sent the walk to the root of history.

import { describe, expect, it } from "vitest";

import { fileHistoryNotice } from "./derive";
import type { CommitInfo, FileHistory, HistoryStop } from "./types";

const commit = (n: number): CommitInfo => ({
  oid: String(n).repeat(40).slice(0, 40),
  shortOid: String(n).repeat(7).slice(0, 7),
  summary: `change ${n}`,
  body: null,
  author: "Author",
  email: "author@example.com",
  timestamp: 1_700_000_000,
  parents: [],
  refs: [],
});

const history = (
  stoppedAt: HistoryStop,
  visited: number,
  matches = 3,
): FileHistory => ({
  commits: Array.from({ length: matches }, (_, i) => commit(i + 1)),
  visited,
  stoppedAt,
});

describe("fileHistoryNotice", () => {
  it("says nothing when there is nothing to admit to", () => {
    expect(fileHistoryNotice(null)).toBeNull();
    expect(fileHistoryNotice(undefined)).toBeNull();
    expect(fileHistoryNotice(history("Exhausted", 412))).toBeNull();
  });

  it("names the number of commits the search actually looked at", () => {
    const notice = fileHistoryNotice(history("VisitLimit", 50_000));
    expect(notice?.title).toContain("50,000");
    expect(notice?.detail).toMatch(/history/i);
  });

  // The cap is backend policy. A frontend that spelled 50,000 itself would keep
  // saying 50,000 after the policy moved — so the sentence has to follow the
  // number that came back, whatever it is.
  it("reports the cap it was given, not a number of its own", () => {
    expect(fileHistoryNotice(history("VisitLimit", 20_000))?.title).toContain(
      "20,000",
    );
    expect(fileHistoryNotice(history("VisitLimit", 1_500_000))?.title).toContain(
      "1,500,000",
    );
  });

  it("offers the rest of history only when more searching would find it", () => {
    expect(fileHistoryNotice(history("VisitLimit", 50_000))?.canSearchAll).toBe(
      true,
    );
    // A full list stays full however far the walk goes: the button would run
    // for minutes and change nothing on screen.
    expect(fileHistoryNotice(history("MatchLimit", 900, 200))?.canSearchAll).toBe(
      false,
    );
  });

  it("counts the list, not the walk, when the list is what filled up", () => {
    const notice = fileHistoryNotice(history("MatchLimit", 1_234, 200));
    expect(notice?.title).toContain("200");
    expect(notice?.title).not.toContain("1,234");
  });

  // If two stops read the same, the type has bought nothing.
  it("says something different for each stop", () => {
    const visit = fileHistoryNotice(history("VisitLimit", 50_000));
    const match = fileHistoryNotice(history("MatchLimit", 50_000, 200));
    expect(visit?.title).not.toBe(match?.title);
    expect(visit?.detail).not.toBe(match?.detail);
  });

  // Reaching the match limit means the WALK had commits left, not that any of
  // them touched this file. Anything stronger says more than was measured.
  it("does not claim older changes definitely exist when the list filled up", () => {
    const notice = fileHistoryNotice(history("MatchLimit", 1_234, 200));
    expect(notice?.detail).toMatch(/may be/i);
  });
});
