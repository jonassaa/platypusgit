// History's graph column must size itself to the lanes actually present, and it
// must feed layoutGraph the unfiltered window as ancestry so two search hits on
// one branch resolve to a single dashed lane (#68 G1/G2).
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { graphWidth } from "@/design/graph-geometry";
import type { CommitInfo } from "@/lib/types";

/** 40-char oids: History renders shortOid, and selection keys off the full oid. */
const oid = (label: string) => label.repeat(40).slice(0, 40);

const mk = (label: string, parents: string[] = []): CommitInfo => ({
  oid: oid(label),
  shortOid: oid(label).slice(0, 7),
  summary: `subject ${label}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

// Linear: A → B → C.
const A = mk("a", [oid("b")]);
const B = mk("b", [oid("c")]);
const C = mk("c");
const LINEAR = [A, B, C];

function primeStore(over: Record<string, unknown> = {}) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: LINEAR,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
    ...over,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
}

const rows = (c: HTMLElement) => c.querySelectorAll('[data-testid="commit-row"]');

beforeEach(() => primeStore());

describe("History graph column", () => {
  it("sizes the gutter to a single-lane log", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    const svg = container.querySelector('[data-testid="commit-row"] svg')!;
    expect(svg.getAttribute("width")).toBe(String(graphWidth(0)));
  });

  it("keeps the header grid in step with the row grid", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    const header = container.querySelector<HTMLElement>('[data-testid="commit-header"]')!;
    expect(header.style.gridTemplateColumns).toBe(row.style.gridTemplateColumns);
  });

  // The UNION is the point: searchResults has no intervening commits by
  // construction, so without `commits` as ancestry these two hits cannot be
  // linked and each would trail its own phantom lane.
  //
  // Note `searchActive` derives from the SEARCH INPUT, not from searchResults
  // being populated — so the query has to be typed for History to switch over
  // to the filtered list.
  it("feeds the unfiltered window as ancestry so search hits share one lane", async () => {
    primeStore({ searchResults: [A, C] });
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));

    fireEvent.change(container.querySelector('[data-testid="history-search"]')!, {
      target: { value: "subject" },
    });

    // 250ms search debounce, so allow more than waitFor's 1s default.
    await waitFor(() => expect(rows(container).length).toBe(2), { timeout: 3000 });

    // One lane: both rows keep the minimal single-lane gutter.
    for (const svg of container.querySelectorAll('[data-testid="commit-row"] svg')) {
      expect(svg.getAttribute("width")).toBe(String(graphWidth(0)));
    }
    // And the elided link is drawn dashed.
    expect(container.querySelector("[stroke-dasharray]")).not.toBeNull();
  });

  it("does not dash anything when nothing is elided", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    expect(container.querySelector("[stroke-dasharray]")).toBeNull();
  });

  it("marks HEAD's commit in the graph gutter", async () => {
    primeStore({
      branches: [
        {
          name: "main",
          isHead: true,
          isRemote: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          tip: oid("a"),
        },
      ],
    });
    const { container } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(container.querySelector('[data-graph-head="true"]')).not.toBeNull();
    });
  });
});
