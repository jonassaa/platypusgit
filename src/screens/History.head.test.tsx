// The "you are here" (HEAD) row treatment is user-chosen: any subset of six
// marks, at one of three weights. These tests pin that each mark lands only when
// it is on, that the weight knob actually moves pixels, and that selection still
// outranks the wash.
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { HeadMark, HeadWeight } from "@/features/settings/headMarks";
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

async function renderWith(marks: HeadMark[], weight: HeadWeight = "strong") {
  useSettingsStore.getState().set("headMarks", marks);
  useSettingsStore.getState().set("headWeight", weight);
  render(<HistoryScreen />);
  await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));
  const rows = screen.getAllByTestId("commit-row");
  return { headRow: rows[1], otherRow: rows[2], selectedRow: rows[0] };
}

const tinted = (row: HTMLElement) => row.style.background.includes("var(--accent)");
const bar = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('[data-testid="commit-head-bar"]');
const outlined = (row: HTMLElement) => row.style.boxShadow.includes("inset");
const badged = (row: HTMLElement) =>
  !!row.querySelector('[data-testid="commit-head-badge"]');
const subjectWeight = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('[data-testid="commit-subject"]')!.style.fontWeight;
const ring = (row: HTMLElement) =>
  row.querySelector<SVGElement>("[data-graph-head]");
const ringGlow = (row: HTMLElement) =>
  row.querySelector<SVGElement>("[data-graph-head-glow]");

describe("History HEAD marks", () => {
  beforeEach(primeStore);

  it("marks only the HEAD row", async () => {
    const { headRow, otherRow } = await renderWith(["bar", "tint"]);
    expect(headRow.dataset.head).toBe("true");
    expect(otherRow.dataset.head).toBeUndefined();
    expect(bar(otherRow)).toBeNull();
    expect(tinted(otherRow)).toBe(false);
  });

  it("draws an edge bar and no wash for ['bar']", async () => {
    const { headRow } = await renderWith(["bar"]);
    expect(bar(headRow)).not.toBeNull();
    expect(tinted(headRow)).toBe(false);
  });

  it("washes the row and draws no bar for ['tint']", async () => {
    const { headRow } = await renderWith(["tint"]);
    expect(tinted(headRow)).toBe(true);
    expect(bar(headRow)).toBeNull();
  });

  it("insets an accent outline for ['outline']", async () => {
    const { headRow, otherRow } = await renderWith(["outline"]);
    expect(outlined(headRow)).toBe(true);
    expect(outlined(otherRow)).toBe(false);
  });

  it("adds a HEAD pill for ['badge']", async () => {
    const { headRow, otherRow } = await renderWith(["badge"]);
    expect(badged(headRow)).toBe(true);
    expect(badged(otherRow)).toBe(false);
  });

  it("bolds the subject for ['bold'] and leaves other rows alone", async () => {
    const { headRow, otherRow } = await renderWith(["bold"]);
    expect(Number(subjectWeight(headRow))).toBeGreaterThan(400);
    expect(subjectWeight(otherRow)).toBe("");
  });

  it("draws the graph ring only when 'ring' is on", async () => {
    const { headRow: withRing } = await renderWith(["ring"]);
    expect(ring(withRing)).not.toBeNull();

    // Unmount before the second render — two HistoryScreens in one document
    // would make getAllByTestId return six rows.
    cleanup();
    primeStore();
    const { headRow: withoutRing } = await renderWith(["bar"]);
    expect(ring(withoutRing)).toBeNull();
  });

  it("leaves the row completely alone when no mark is on", async () => {
    const { headRow } = await renderWith([]);
    expect(bar(headRow)).toBeNull();
    expect(tinted(headRow)).toBe(false);
    expect(outlined(headRow)).toBe(false);
    expect(badged(headRow)).toBe(false);
    expect(ring(headRow)).toBeNull();
    // Still flagged in the DOM, so a future surface can find the row.
    expect(headRow.dataset.head).toBe("true");
  });

  it("makes the weight knob visible on the bar and the ring", async () => {
    const { headRow: subtle } = await renderWith(["bar", "ring"], "subtle");
    const subtleW = bar(subtle)!.style.width;
    expect(ringGlow(subtle)).toBeNull(); // no halo at the lightest weight

    cleanup();
    primeStore();
    const { headRow: intense } = await renderWith(["bar", "ring"], "intense");
    expect(parseFloat(bar(intense)!.style.width)).toBeGreaterThan(
      parseFloat(subtleW),
    );
    expect(ringGlow(intense)).not.toBeNull();
  });

  it("deepens the wash as the weight goes up", async () => {
    const alpha = (row: HTMLElement) =>
      Number(row.style.background.match(/\/\s*([\d.]+)\s*\)/)?.[1]);

    const { headRow: subtle } = await renderWith(["tint"], "subtle");
    const light = alpha(subtle);
    cleanup();
    primeStore();
    const { headRow: intense } = await renderWith(["tint"], "intense");
    expect(alpha(intense)).toBeGreaterThan(light);
  });

  it("lets selection outrank the wash on a selected HEAD row, keeping the other marks", async () => {
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
    useSettingsStore.getState().set("headMarks", ["bar", "tint", "outline", "badge"]);
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getAllByTestId("commit-row").length).toBe(3));
    const row = screen.getAllByTestId("commit-row")[0];

    expect(row.dataset.selected).toBe("true");
    expect(row.dataset.head).toBe("true");
    expect(tinted(row)).toBe(false); // selection background wins
    // …but "you are here" still reads. This is why 'outline' exists: unlike the
    // wash, it survives on the selected row.
    expect(bar(row)).not.toBeNull();
    expect(outlined(row)).toBe(true);
    expect(badged(row)).toBe(true);
  });

  it("persists both choices", async () => {
    await renderWith(["outline", "badge"], "intense");
    const raw = JSON.parse(localStorage.getItem("pg-settings-v2") ?? "{}");
    expect(raw.headMarks).toEqual(["outline", "badge"]);
    expect(raw.headWeight).toBe("intense");
  });
});
