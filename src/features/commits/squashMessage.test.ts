import { describe, expect, it } from "vitest";

import { combinedSquashMessage } from "./squashMessage";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, summary: string, body: string | null = null): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: [],
  refs: [],
});

const map = (...cs: CommitInfo[]) => new Map(cs.map((c) => [c.oid, c]));

describe("combinedSquashMessage", () => {
  it("joins each commit's message in the given (oldest-first) order", () => {
    const m = map(mk("a", "feat: one"), mk("b", "feat: two"));
    expect(combinedSquashMessage(["a", "b"], m)).toBe("feat: one\n\nfeat: two");
  });

  it("keeps bodies under their own subject", () => {
    const m = map(mk("a", "feat: one", "why one\nmore"), mk("b", "fix: two"));
    expect(combinedSquashMessage(["a", "b"], m)).toBe(
      "feat: one\n\nwhy one\nmore\n\nfix: two",
    );
  });

  it("skips oids the log window does not hold", () => {
    const m = map(mk("a", "feat: one"));
    expect(combinedSquashMessage(["a", "missing"], m)).toBe("feat: one");
  });

  it("is empty for an empty selection", () => {
    expect(combinedSquashMessage([], map())).toBe("");
  });
});
