// Selecting a blamed line (#297).
//
// The app is `user-select: none` everywhere (`index.css`), and surfaces that
// show code opt back in per cell with `.pg-selectable` — the code, never the
// gutters, so a copied block pastes as source rather than as a column of
// metadata. All four diff surfaces have done this since #61.
//
// Blame never did, and nothing caught it: the screen looks completely normal,
// and "I cannot select this text" is not a thing anyone reports until they try
// to copy a line out. That is the whole failure mode this file exists for.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { BlameScreen } from "./Blame";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { BlameLine, BlameResult } from "@/lib/types";

const line = (over: Partial<BlameLine>): BlameLine => ({
  lineNo: 1,
  oid: "1".repeat(40),
  shortOid: "1111111",
  author: "Author",
  email: "author@example.com",
  timestamp: 1_700_000_000,
  summary: "write the lines",
  content: "    alpha",
  ignored: false,
  unblamable: false,
  ...over,
});

const RESULT: BlameResult = {
  lines: [
    line({ lineNo: 1, content: "const alpha = 1" }),
    line({ lineNo: 2, content: "const beta = 2", shortOid: "2222222", author: "Other" }),
  ],
  ignoreRevsFile: null,
  ignoreRevsApplied: false,
  markIgnoredLines: false,
  markUnblamableLines: false,
  ignoreRevsError: null,
};

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
  } as never);
  useNavStore.setState({ intent: { kind: "blame", path: "src.txt" } });
});

async function renderBlame() {
  mockInvoke("blame_file", () => RESULT);
  const r = render(<BlameScreen />);
  await waitFor(() => expect(screen.getAllByTestId("blame-line")).toHaveLength(2));
  return r;
}

describe("Blame selection", () => {
  it("makes each line's source selectable", async () => {
    const { container } = await renderBlame();
    // jsdom applies no stylesheet, so the CLASS is the assertion — the rule it
    // keys on is pinned by `src/design/diffSelection.test.tsx`.
    expect(
      [...container.querySelectorAll(".pg-selectable")].map((el) => el.textContent),
    ).toEqual(["const alpha = 1", "const beta = 2"]);
  });

  it("leaves the oid, author and line number out of it", async () => {
    const { container } = await renderBlame();
    const selectable = [...container.querySelectorAll(".pg-selectable")]
      .map((el) => el.textContent)
      .join("");
    // Otherwise copying three lines of a file hands you three lines of file with
    // a commit hash and a name wedged into each one.
    expect(selectable).not.toContain("1111111");
    expect(selectable).not.toContain("Author");
    expect(selectable).not.toContain("Other");
  });
});
