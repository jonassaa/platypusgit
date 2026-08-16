// Branch compare (#131). What these pin is the split the spec argues for: a
// rev↔rev pair has ancestry, so it gets the ahead/behind summary and both
// commit lists; a working-tree right side has none, so it gets NEITHER — and
// goes down a different backend op with untracked files switched on.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CompareScreen } from "./Compare";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useCompareStore } from "@/features/compare/useCompareStore";
import { WORKDIR } from "@/features/compare/compareSides";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { AheadBehind, BranchInfo, CommitInfo, FileDiff } from "@/lib/types";

const handle = { id: "repo-1", path: "/repo", head: "refs/heads/main" };

const branches: BranchInfo[] = [
  {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "a".repeat(40),
  },
  {
    name: "feature",
    isHead: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "b".repeat(40),
  },
];

function commit(oid: string, summary: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Dev",
    email: "dev@example.com",
    timestamp: 1_700_000_000,
    parents: [],
    refs: [],
  };
}

const DIFF: FileDiff[] = [
  {
    path: "src/a.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [],
  } as unknown as FileDiff,
];

const SUMMARY: AheadBehind = {
  ahead: 3,
  behind: 2,
  mergeBase: "c".repeat(40),
};

function wire() {
  mockInvoke("ahead_behind", () => SUMMARY);
  mockInvoke("commits_between", (args) =>
    args.base === "main"
      ? [commit("1".repeat(40), "feature work")]
      : [commit("2".repeat(40), "main work")],
  );
  mockInvoke("diff_commits", () => DIFF);
  mockInvoke("diff_ref_to_workdir", () => DIFF);
  mockInvoke("read_file_content_at_rev", () => ({
    path: "src/a.ts",
    binary: false,
    text: "",
    fromHead: true,
    size: 0,
  }));
  mockInvoke("read_file_content", () => ({
    path: "src/a.ts",
    binary: false,
    text: "",
    fromHead: false,
    size: 0,
  }));
}

function mount() {
  useRepoStore.setState({ current: handle, branches, tags: [] } as never);
  render(<CompareScreen />);
}

beforeEach(() => {
  wire();
  useCompareStore.setState({
    repoId: null,
    left: { kind: "rev", rev: "main" },
    right: WORKDIR,
    diffs: [],
    summary: null,
    aheadCommits: [],
    behindCommits: [],
    loading: false,
    error: null,
    marked: null,
  });
});

describe("rev ↔ rev", () => {
  beforeEach(() => {
    useCompareStore.getState().open(
      { kind: "rev", rev: "main" },
      { kind: "rev", rev: "feature" },
    );
  });

  it("renders the summary and both commit lists off one pair", async () => {
    mount();

    await waitFor(() =>
      expect(screen.getByTestId("compare-summary").textContent).toContain("↑3"),
    );
    const summary = screen.getByTestId("compare-summary").textContent ?? "";
    expect(summary).toContain("↓2");
    expect(summary).toContain("base ccccccc");

    // Headings read from the EXACT counts, not the (capped) list lengths.
    expect(
      screen.getByText("3 commits on feature not on main"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 commits on main not on feature"),
    ).toBeInTheDocument();

    expect(screen.getByTestId("compare-ahead-list").textContent).toContain(
      "feature work",
    );
    expect(screen.getByTestId("compare-behind-list").textContent).toContain(
      "main work",
    );
  });

  it("diffs the pair tree-to-tree, never through the workdir op", async () => {
    mount();

    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "diff_commits")).toBe(true),
    );
    const call = getInvokeCalls().find((c) => c.cmd === "diff_commits")!;
    expect(call.args.fromOid).toBe("main");
    expect(call.args.toOid).toBe("feature");
    expect(getInvokeCalls().some((c) => c.cmd === "diff_ref_to_workdir")).toBe(
      false,
    );
  });

  it("swap flips the sides and re-reads", async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("compare-summary").textContent).toContain("↑3"),
    );

    fireEvent.click(screen.getByTestId("compare-swap"));

    await waitFor(() => {
      const call = [...getInvokeCalls()]
        .reverse()
        .find((c) => c.cmd === "diff_commits")!;
      expect(call.args.fromOid).toBe("feature");
      expect(call.args.toOid).toBe("main");
    });
    expect(screen.getByTestId("compare-side-left").textContent).toContain(
      "feature",
    );
  });

  it("renders a backend refusal in place, not through the app banner", async () => {
    mockInvoke("ahead_behind", () => {
      throw { kind: "InvalidRef", message: "nope" };
    });
    mount();

    await waitFor(() =>
      expect(screen.getByTestId("compare-error")).toBeInTheDocument(),
    );
    expect(useRepoStore.getState().error).toBeNull();
  });
});

describe("rev ↔ working tree", () => {
  beforeEach(() => {
    useCompareStore
      .getState()
      .open({ kind: "rev", rev: "main" }, WORKDIR);
  });

  it("has no ancestry, so it renders neither commit list nor a summary", async () => {
    mount();

    await waitFor(() =>
      expect(
        getInvokeCalls().some((c) => c.cmd === "diff_ref_to_workdir"),
      ).toBe(true),
    );
    expect(screen.queryByTestId("compare-ahead-list")).toBeNull();
    expect(screen.queryByTestId("compare-behind-list")).toBeNull();
    expect(screen.getByTestId("compare-summary").textContent).not.toContain("↑");
    expect(getInvokeCalls().some((c) => c.cmd === "ahead_behind")).toBe(false);
    expect(getInvokeCalls().some((c) => c.cmd === "commits_between")).toBe(false);
  });

  it("includes untracked files, and says so on the chip", async () => {
    mount();

    await waitFor(() =>
      expect(
        getInvokeCalls().some((c) => c.cmd === "diff_ref_to_workdir"),
      ).toBe(true),
    );
    const call = getInvokeCalls().find((c) => c.cmd === "diff_ref_to_workdir")!;
    expect(call.args.revspec).toBe("main");
    expect(call.args.includeUntracked).toBe(true);

    expect(screen.getByTestId("compare-side-right").textContent).toContain(
      "Working tree",
    );
    expect(screen.getByTestId("compare-side-right").textContent).toContain(
      "untracked",
    );
  });

  it("refuses to swap the working tree onto the base side", async () => {
    mount();
    await waitFor(() =>
      expect(
        getInvokeCalls().some((c) => c.cmd === "diff_ref_to_workdir"),
      ).toBe(true),
    );

    expect(screen.getByTestId("compare-swap")).toBeDisabled();
    fireEvent.click(screen.getByTestId("compare-swap"));
    expect(useCompareStore.getState().left).toEqual({ kind: "rev", rev: "main" });
    expect(useCompareStore.getState().right).toEqual(WORKDIR);
  });
});

describe("the side picker", () => {
  beforeEach(() => {
    useCompareStore.getState().open(
      { kind: "rev", rev: "main" },
      { kind: "rev", rev: "feature" },
    );
  });

  it("offers the working tree on the right only", async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("compare-summary").textContent).toContain("↑3"),
    );

    fireEvent.click(screen.getByTestId("compare-side-right"));
    await waitFor(() =>
      expect(screen.getAllByTestId("compare-side-option").length).toBeGreaterThan(0),
    );
    const rightLabels = screen
      .getAllByTestId("compare-side-option")
      .map((el) => el.textContent ?? "");
    expect(rightLabels.some((l) => l.includes("Working tree"))).toBe(true);

    // Close the right popover, open the left one.
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByTestId("compare-side-left"));
    await waitFor(() =>
      expect(screen.getAllByTestId("compare-side-option").length).toBeGreaterThan(0),
    );
    const leftLabels = screen
      .getAllByTestId("compare-side-option")
      .map((el) => el.textContent ?? "");
    expect(leftLabels.some((l) => l.includes("Working tree"))).toBe(false);
    expect(leftLabels.some((l) => l.includes("feature"))).toBe(true);
  });

  it("picking a branch re-reads against it", async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("compare-summary").textContent).toContain("↑3"),
    );

    fireEvent.click(screen.getByTestId("compare-side-right"));
    await waitFor(() =>
      expect(screen.getAllByTestId("compare-side-option").length).toBeGreaterThan(0),
    );
    const row = screen
      .getAllByTestId("compare-side-option")
      .find((el) => (el.textContent ?? "").includes("Working tree"))!;
    fireEvent.click(row);

    await waitFor(() =>
      expect(
        getInvokeCalls().some((c) => c.cmd === "diff_ref_to_workdir"),
      ).toBe(true),
    );
  });
});

vi.mock("@/lib/syntax", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/syntax");
  return {
    ...actual,
    // Tokenisation is irrelevant here and pulls Shiki into every case.
    useDiffSyntax: () => ({ old: null, new: null, oldText: null, newText: null }),
    usePrefetchSyntax: () => {},
  };
});
