// A tag on a log row has to READ as a tag. git calls a branch and a tag both a
// ref, and the row drew a branch icon for either, so `v1.0.0` looked like a
// branch sitting next to `main` — the one thing a history view exists to tell
// apart at a glance.
//
// Rendered rather than unit-tested because the glyph travels three hops from
// the kind the backend sent — mapCommitRefs → PGCommitRow → PGBranchPill — and
// each one has its own default of "branch".
import { describe, expect, it, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo, RefInfo } from "@/lib/types";

const oid = (label: string) => label.repeat(40).slice(0, 40);

const mk = (label: string, refs: RefInfo[], parents: string[] = []): CommitInfo => ({
  oid: oid(label),
  shortOid: oid(label).slice(0, 7),
  summary: `subject ${label}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs,
});

// Tip carries the branch HEAD is on and a release tag; its parent carries a
// slashed tag, the shape that used to be split into a remote called `release`.
const COMMITS = [
  mk("a", [{ name: "main", kind: "Branch" }, { name: "v1.0.0", kind: "Tag" }], [oid("b")]),
  mk("b", [{ name: "release/0.9", kind: "Tag" }]),
];

beforeEach(() => {
  localStorage.clear();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [{ name: "main", isHead: true, isRemote: false, tip: oid("a") }],
    status: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
});

/** The pill for one ref, found by the name git knows it as. */
const pill = (c: HTMLElement, ref: string) =>
  c.querySelector<HTMLElement>(`[data-pg-ref="${ref}"]`);

/**
 * Which glyph a pill drew. lucide names its own svg class after the icon, and
 * `PGIcon` is the only file allowed to import lucide — so this is the one
 * place that reads that class, and it is what makes "a tag icon, not a branch
 * icon" an assertion rather than a screenshot.
 */
const glyph = (el: HTMLElement) =>
  el.querySelector("svg")?.getAttribute("class") ?? "";

describe("ref pills on a log row", () => {
  it("draws a tag with the tag glyph", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(pill(container, "v1.0.0")).not.toBeNull());
    expect(glyph(pill(container, "v1.0.0")!)).toContain("lucide-tag");
  });

  it("still draws a branch with the branch glyph", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(pill(container, "main")).not.toBeNull());
    const drawn = glyph(pill(container, "main")!);
    expect(drawn).not.toContain("lucide-tag");
    expect(pill(container, "main")!.textContent).toBe("HEAD→main");
  });

  it("shows a slashed tag whole, not as a remote's branch", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(pill(container, "release/0.9")).not.toBeNull());
    const el = pill(container, "release/0.9")!;
    expect(el.textContent).toBe("release/0.9");
    expect(glyph(el)).toContain("lucide-tag");
    // The remote half of a remote pill is dimmed in its own span; a tag has no
    // remote half at all, so the name is one run of text.
    expect(el.querySelectorAll("span").length).toBe(1);
  });
});
