// Opening a repo while History is the active screen renders the screen twice:
// once with an empty log (the store clears `commits` on open), then again once
// the log arrives. Those two renders must run the SAME hooks.
//
// They did not: an early return for the empty log sat above four hooks, so the
// second render called more hooks than the first. React aborts the whole root
// on that (error #310) and, with no error boundary mounted, the window went
// blank — background colour and nothing else.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo } from "@/lib/types";

const commit: CommitInfo = {
  oid: "a".repeat(40),
  shortOid: "a".repeat(7),
  summary: "first commit",
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: [],
  refs: ["refs/heads/main"],
};

describe("History screen when the log arrives after mount", () => {
  beforeEach(() => {
    localStorage.clear();
    // The state the repo store is in immediately after `openRepo`: a repo is
    // current, the log has not landed yet.
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      commits: [],
      searchResults: null,
      searching: false,
      searchCommits: async () => {},
      branches: [],
      status: [],
      loading: true,
    } as never);
    useNavStore.setState({ intent: null });
    useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
    mockInvoke("get_log_page", () => ({ commits: [commit], nextCursor: null }));
    mockInvoke("diff_commit", () => []);
    mockInvoke("get_status", () => []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps rendering when commits load into an initially empty log", async () => {
    // React logs the hook-order violation through console.error before it
    // rethrows; fail loudly on it rather than letting it colour the output.
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    render(<HistoryScreen />);
    // The loading state is skeleton rows rather than a text label since #61 B6,
    // so this asserts the accessible name — same intent: the screen renders
    // during the loading phase, before the log arrives.
    expect(screen.getByLabelText(/Loading commits/i)).toBeInTheDocument();

    // The log lands — same component, second render, must use the same hooks.
    await act(async () => {
      useRepoStore.setState({ commits: [commit], loading: false } as never);
    });

    expect(
      errors.filter((e) => /Rendered more hooks|error #310|#310/.test(e)),
    ).toEqual([]);
    // Summary shows in both the row and the detail panel — the point is that
    // the screen rendered at all.
    expect(screen.getAllByText("first commit").length).toBeGreaterThan(0);
  });
});
