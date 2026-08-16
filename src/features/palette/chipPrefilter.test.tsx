import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette } from "./CommandPalette";
import { paletteInitial, usePaletteStore } from "./usePaletteStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { BranchInfo, CommitInfo, FileStatus } from "@/lib/types";

// Records every string the palette hands to the fuzzy matcher. The root-step
// candidate set is ~500 rows on a real repo, and the chip pre-filter exists so
// a selected chip does NOT pay to score all of them on every keystroke — this
// file pins that. Lives in its own test file so the module mock stays scoped.
const scored = vi.hoisted(() => ({ targets: [] as string[] }));

vi.mock("./fuzzyMatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fuzzyMatch")>();
  return {
    ...actual,
    fuzzyMatch: (query: string, target: string) => {
      scored.targets.push(target);
      return actual.fuzzyMatch(query, target);
    },
  };
});

const mkBranch = (name: string, isHead = false): BranchInfo => ({
  name, isHead, isRemote: false, upstream: null, ahead: 0, behind: 0, tip: "deadbeef",
  tipTime: 0, isDefault: false,
});
const mkCommit = (oid: string, summary: string): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary, body: null, author: "Dev", email: "",
  timestamp: 0, parents: [], refs: [],
});
const mkFile = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

const FILES = [mkFile("src/alpha.ts"), mkFile("src/beta.ts")];

describe("root-step chip pre-filter", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      status: [],
      allFiles: FILES,
      branches: [mkBranch("main", true), mkBranch("feature/alpha")],
      tags: [], stashes: [], remotes: [],
      commits: [mkCommit("abcdef1234", "alpha landed")],
      loading: false, error: null, repoState: "Clean",
      rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
      activity: {},
    });
    useNavStore.setState({ intent: null });
    usePaletteStore.setState(paletteInitial());
    localStorage.clear();
    // Opening the palette refreshes the tracked-file list, so the mock has to
    // return the same fixture or the file rows vanish before the first keystroke.
    mockInvoke("list_all_files", () => FILES);
    scored.targets = [];
  });

  /** Focus the query input — a chip click leaves focus on the chip button. */
  const focusQuery = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByPlaceholderText(/Search branches/i));
  };

  it("scores only the selected chip's rows, never the whole candidate set", async () => {
    const user = userEvent.setup();
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Branches" }));
    expect(usePaletteStore.getState().activeChip).toBe("branch");
    await focusQuery(user);

    // From here on only branch rows may be scored. A regression that builds
    // every candidate, matches every candidate and filters at render time would
    // put command labels ("Go to History"), file paths and commit summaries in
    // this list.
    scored.targets = [];
    await user.keyboard("alpha");

    expect(scored.targets.length).toBeGreaterThan(0);
    const branchNames = new Set(["main", "feature/alpha"]);
    expect(scored.targets.every((t) => branchNames.has(t))).toBe(true);
  });

  it("scores every type under the All chip", async () => {
    // Counterpart to the test above: the pre-filter must not leak into the
    // default chip, where all four types are searchable.
    const user = userEvent.setup();
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await screen.findByRole("dialog");
    await focusQuery(user);

    scored.targets = [];
    await user.keyboard("alpha");

    expect(scored.targets).toContain("feature/alpha");
    expect(scored.targets).toContain("src/alpha.ts");
    expect(scored.targets).toContain("alpha landed abcdef1 Dev");
    // …and the commands too (search string of the History nav row).
    expect(scored.targets).toContain("History history go to");
  });
});
