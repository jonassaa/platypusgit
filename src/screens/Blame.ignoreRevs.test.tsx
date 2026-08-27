// `blame.ignoreRevsFile` on the Blame screen (#253).
//
// Blame that names whoever ran the formatter is worse than no blame: the answer
// looks authoritative and is wrong. `.git-blame-ignore-revs` is git's fix, so
// the screen honours it by default — and offers a toggle, because "who really
// touched this line" and "which commit rewrote this line" are both real
// questions and only the repository knows which one you are asking.
//
// The toggle only exists where an ignore-revs file does, so a repository
// without one gains no chrome it cannot use.

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BlameScreen } from "./Blame";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
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

const result = (over: Partial<BlameResult>): BlameResult => ({
  lines: [line({})],
  ignoreRevsFile: null,
  ignoreRevsApplied: false,
  markIgnoredLines: false,
  markUnblamableLines: false,
  ignoreRevsError: null,
  ...over,
});

const IGNORED = result({
  lines: [line({ author: "Author" })],
  ignoreRevsFile: ".git-blame-ignore-revs",
  ignoreRevsApplied: true,
});

const UNIGNORED = result({
  lines: [
    line({
      author: "Formatter",
      oid: "2".repeat(40),
      shortOid: "2222222",
      summary: "reindent everything",
    }),
  ],
  ignoreRevsFile: ".git-blame-ignore-revs",
  ignoreRevsApplied: false,
});

const blameCalls = () => getInvokeCalls().filter((c) => c.cmd === "blame_file");

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
  } as never);
  useNavStore.setState({ intent: { kind: "blame", path: "src.txt" } });
});

describe("Blame with an ignore-revs file", () => {
  it("asks for the ignored view first and shows the original author", async () => {
    mockInvoke("blame_file", () => IGNORED);
    render(<BlameScreen />);

    await waitFor(() => expect(blameCalls()).toHaveLength(1));
    expect(blameCalls()[0].args.ignoreRevs).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("blame-content").textContent).toContain("Author"),
    );
  });

  it("switches to the un-ignored view and back", async () => {
    mockInvoke("blame_file", (args) =>
      args.ignoreRevs === false ? UNIGNORED : IGNORED,
    );
    render(<BlameScreen />);

    const toggle = await screen.findByTestId("blame-ignore-revs-toggle");
    fireEvent.click(toggle);

    await waitFor(() => expect(blameCalls()).toHaveLength(2));
    expect(blameCalls()[1].args.ignoreRevs).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId("blame-content").textContent).toContain(
        "Formatter",
      ),
    );

    fireEvent.click(screen.getByTestId("blame-ignore-revs-toggle"));
    await waitFor(() => expect(blameCalls()).toHaveLength(3));
    expect(blameCalls()[2].args.ignoreRevs).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("blame-content").textContent).toContain("Author"),
    );
  });

  it("offers no toggle when the repository configures no ignore-revs file", async () => {
    mockInvoke("blame_file", () => result({}));
    render(<BlameScreen />);

    await waitFor(() => expect(blameCalls()).toHaveLength(1));
    expect(screen.queryByTestId("blame-ignore-revs-toggle")).toBeNull();
  });

  it("marks the lines git marked, only when markIgnoredLines is on", async () => {
    mockInvoke("blame_file", () =>
      result({
        lines: [line({ ignored: true }), line({ lineNo: 2, unblamable: true })],
        ignoreRevsFile: ".git-blame-ignore-revs",
        ignoreRevsApplied: true,
        markIgnoredLines: true,
        markUnblamableLines: true,
      }),
    );
    render(<BlameScreen />);

    await waitFor(() =>
      expect(screen.getAllByTestId("blame-line").length).toBe(2),
    );
    const rows = screen.getAllByTestId("blame-line");
    expect(rows[0].textContent).toContain("?");
    expect(rows[1].textContent).toContain("*");
  });

  it("warns about an unusable ignore-revs file without losing the blame", async () => {
    // The backend degraded to a plain blame and said why. Losing the screen
    // over a config line would be absurd, so the lines must still be there.
    mockInvoke("blame_file", () =>
      result({
        ignoreRevsFile: ".no-such-file",
        ignoreRevsApplied: false,
        ignoreRevsError:
          "blame.ignoreRevsFile points at .no-such-file, which is not a readable file",
      }),
    );
    render(<BlameScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("blame-ignore-revs-warning")).toBeTruthy(),
    );
    expect(screen.getByTestId("blame-ignore-revs-warning").textContent).toContain(
      ".no-such-file",
    );
    expect(screen.getAllByTestId("blame-line").length).toBe(1);
  });
});
