// The "you are here" (HEAD) row treatment is user-chosen: an edge bar, a whole
// -row highlight, both, or nothing but the graph's own HEAD ring.
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { useSettingsStore, type HeadIndicator } from "@/features/settings/useSettingsStore";
import type { CommitInfo } from "@/lib/types";

const oid = (label: string) => label.repeat(40).slice(0, 40);
// HEAD is the MIDDLE commit on purpose: History auto-selects the first row, and
// selection outranks the HEAD wash — putting HEAD elsewhere tests the wash
// itself, and the last case below pins the precedence.
const TIP = oid("b");

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

const COMMITS = [mk("a", [oid("b")]), mk("b", [oid("c")]), mk("c")];

function primeStore() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        tip: TIP,
      },
    ],
    status: [],
    loading: false,
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

async function renderWith(indicator: HeadIndicator) {
  useSettingsStore.getState().set("headIndicator", indicator);
  render(<HistoryScreen />);
  await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));
  const rows = screen.getAllByTestId("commit-row");
  return { headRow: rows[1], otherRow: rows[2], selectedRow: rows[0] };
}

const tinted = (row: HTMLElement) => row.style.background.includes("var(--accent)");
const bar = (row: HTMLElement) => !!row.querySelector('[data-testid="commit-head-bar"]');

describe("History HEAD indicator", () => {
  beforeEach(primeStore);

  it("marks only the HEAD row", async () => {
    const { headRow, otherRow } = await renderWith("both");
    expect(headRow.dataset.head).toBe("true");
    expect(otherRow.dataset.head).toBeUndefined();
  });

  it("draws an edge bar and no wash for 'bar'", async () => {
    const { headRow } = await renderWith("bar");
    expect(bar(headRow)).toBe(true);
    expect(tinted(headRow)).toBe(false);
  });

  it("washes the row and draws no bar for 'tint'", async () => {
    const { headRow } = await renderWith("tint");
    expect(tinted(headRow)).toBe(true);
    expect(bar(headRow)).toBe(false);
  });

  it("does both for 'both'", async () => {
    const { headRow } = await renderWith("both");
    expect(bar(headRow)).toBe(true);
    expect(tinted(headRow)).toBe(true);
  });

  it("leaves the row alone for 'none'", async () => {
    const { headRow } = await renderWith("none");
    expect(bar(headRow)).toBe(false);
    expect(tinted(headRow)).toBe(false);
    // Still flagged in the DOM — the graph ring is the indicator here.
    expect(headRow.dataset.head).toBe("true");
  });

  it("lets selection outrank the wash on a selected HEAD row, keeping the bar", async () => {
    // Point the branch at the FIRST commit, which History auto-selects — so
    // this row is both selected and HEAD.
    useRepoStore.setState({
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
    } as never);
    useSettingsStore.getState().set("headIndicator", "both");
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));
    const row = screen.getAllByTestId("commit-row")[0];

    expect(row.dataset.selected).toBe("true");
    expect(row.dataset.head).toBe("true");
    expect(tinted(row)).toBe(false); // selection background wins
    expect(bar(row)).toBe(true); // …but "you are here" still reads
  });

  it("persists the choice", async () => {
    await renderWith("tint");
    const raw = localStorage.getItem("pg-settings-v2") ?? "{}";
    expect(JSON.parse(raw).headIndicator).toBe("tint");
  });
});
