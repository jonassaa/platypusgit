// History asks for the next page as the window nears the end of the loaded
// list, and stops asking at the end of history (#68 G11).
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

const oid = (n: number) => String(n).padStart(40, "0");

const LOG: CommitInfo[] = Array.from({ length: 30 }, (_, i) => ({
  oid: oid(i),
  shortOid: oid(i).slice(0, 7),
  summary: `commit ${i}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: i + 1 < 30 ? [oid(i + 1)] : [],
  refs: [],
}));

function prime(over: Record<string, unknown>) {
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  useNavStore.setState({ intent: null });
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: LOG,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
    loadingMore: false,
    searchCursor: null,
    ...over,
  } as never);
}

describe("History pagination", () => {
  beforeEach(() => {
    useNavStore.setState({ intent: null });
  });

  it("requests the next page when more history remains", async () => {
    const loadMoreCommits = vi.fn(async () => {});
    prime({ commitCursor: ["frontier-oid"], loadMoreCommits });

    render(<HistoryScreen />);

    // jsdom reports a zero-height viewport, so the window renders a screenful
    // and immediately sits within LOAD_MORE_SLACK of this 30-commit list.
    await waitFor(() => expect(loadMoreCommits).toHaveBeenCalled());
  });

  it("does not request anything at the end of history", async () => {
    const loadMoreCommits = vi.fn(async () => {});
    prime({ commitCursor: null, loadMoreCommits });

    render(<HistoryScreen />);

    await new Promise((r) => setTimeout(r, 20));
    expect(loadMoreCommits).not.toHaveBeenCalled();
  });

  it("does not stack requests while one is already in flight", async () => {
    const loadMoreCommits = vi.fn(async () => {});
    prime({ commitCursor: ["frontier-oid"], loadingMore: true, loadMoreCommits });

    render(<HistoryScreen />);

    await new Promise((r) => setTimeout(r, 20));
    expect(loadMoreCommits).not.toHaveBeenCalled();
  });

  it("shows a loading affordance instead of a silent bottom edge", async () => {
    prime({
      commitCursor: ["frontier-oid"],
      loadingMore: true,
      loadMoreCommits: async () => {},
    });

    const { container } = render(<HistoryScreen />);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="log-loading-more"]')).not.toBeNull(),
    );
  });

  it("paginates a filtered list from its own cursor", async () => {
    const loadMoreCommits = vi.fn(async () => {});
    prime({
      // Base log is exhausted; the SEARCH list is the one with more to fetch.
      commitCursor: null,
      searchResults: LOG.slice(0, 10),
      searchCursor: ["search-frontier"],
      loadMoreCommits,
    });

    render(<HistoryScreen />);

    await waitFor(() => expect(loadMoreCommits).toHaveBeenCalled());
  });
});
