import { describe, it, expect } from "vitest";
import { recentCommitMessages } from "./CommitPanel";
import type { CommitInfo } from "@/lib/types";

const mk = (
  oid: string,
  summary: string,
  body: string | null = null,
  parents: string[] = [],
): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body,
  author: "Ada",
  email: "ada@example.com",
  timestamp: 0,
  parents,
  refs: [],
});

describe("recentCommitMessages", () => {
  it("preserves newest-first order from the log", () => {
    const out = recentCommitMessages([
      mk("c", "third"),
      mk("b", "second"),
      mk("a", "first"),
    ]);
    expect(out.map((r) => r.subject)).toEqual(["third", "second", "first"]);
  });

  it("splits subject and body", () => {
    const out = recentCommitMessages([
      mk("a", "feat: thing", "Why: because.\nMore detail."),
    ]);
    expect(out[0]).toEqual({
      subject: "feat: thing",
      body: "Why: because.\nMore detail.",
    });
  });

  it("dedupes identical messages, keeping the newest", () => {
    const out = recentCommitMessages([
      mk("b", "fix: bug"),
      mk("a", "fix: bug"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].subject).toBe("fix: bug");
  });

  it("strips an existing Signed-off-by trailer from the body", () => {
    const out = recentCommitMessages([
      mk(
        "a",
        "feat: thing",
        "Real body.\n\nSigned-off-by: Ada <ada@example.com>",
      ),
    ]);
    expect(out[0].body).toBe("Real body.");
  });

  it("skips merge commits", () => {
    const out = recentCommitMessages([
      mk("m", "Merge branch 'x'", null, ["a", "b"]),
      mk("a", "feat: real work"),
    ]);
    expect(out.map((r) => r.subject)).toEqual(["feat: real work"]);
  });

  it("skips empty subjects", () => {
    const out = recentCommitMessages([mk("a", "   "), mk("b", "real")]);
    expect(out.map((r) => r.subject)).toEqual(["real"]);
  });

  it("respects the limit", () => {
    const commits = Array.from({ length: 30 }, (_, i) =>
      mk(`oid${i}`, `commit ${i}`),
    );
    expect(recentCommitMessages(commits, 5)).toHaveLength(5);
  });
});
