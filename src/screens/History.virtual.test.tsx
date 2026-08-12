// History mounts only the on-screen slice of the log (#68 G10). The count that
// e2e and a11y care about lives on the container as data-total, because the
// mounted row count is now an implementation detail.
import { describe, expect, it, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { COMMIT_ROW_BASE_H } from "@/design";
import type { CommitInfo } from "@/lib/types";

const oid = (n: number) => String(n).padStart(40, "0");

const BIG: CommitInfo[] = Array.from({ length: 300 }, (_, i) => ({
  oid: oid(i),
  shortOid: oid(i).slice(0, 7),
  summary: `commit ${i}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: i + 1 < 300 ? [oid(i + 1)] : [],
  refs: [],
}));

beforeEach(() => {
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
    commits: BIG,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
  } as never);
});

describe("History virtualization", () => {
  it("reports the full list length even though it mounts a fraction of it", async () => {
    const { container } = render(<HistoryScreen />);
    const list = await waitFor(() => {
      const el = container.querySelector('[data-testid="commit-list"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(list.getAttribute("data-total")).toBe("300");

    const mounted = container.querySelectorAll('[data-testid="commit-row"]').length;
    expect(mounted).toBeGreaterThan(0);
    // jsdom reports clientHeight 0, so the hook falls back to one screenful.
    // The point stands either way: far fewer than 300 rows are in the DOM.
    expect(mounted).toBeLessThan(300);
  });

  it("pads the scroll body to the full list height", async () => {
    const { container } = render(<HistoryScreen />);
    const list = await waitFor(() => {
      const el = container.querySelector('[data-testid="commit-list"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const kids = [...list.children] as HTMLElement[];
    const topPad = Number.parseFloat(kids[0]!.style.height || "0");
    const bottomPad = Number.parseFloat(kids[kids.length - 1]!.style.height || "0");
    const mounted = container.querySelectorAll('[data-testid="commit-row"]').length;

    // Compact density → step 0, so the pitch is the base height. This is the
    // invariant FocusableScroll's End / PageDn depend on.
    expect(topPad + mounted * COMMIT_ROW_BASE_H + bottomPad).toBe(
      300 * COMMIT_ROW_BASE_H,
    );
  });
});
