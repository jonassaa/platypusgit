// Reordering a rebase plan, both ways in: the up/down buttons and a pointer
// drag. jsdom has no layout, so the drag's geometry is fed in by stubbing each
// row wrapper's rect — the hook reads rects only through that one call.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RebaseScreen } from "./Rebase";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo, RebaseStatus, RepoHandle } from "@/lib/types";

const handle: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };

const IDLE: RebaseStatus = { inProgress: false, nextIndex: 0, total: 0, pauseReason: null };

function makeCommit(oid: string, summary: string, parent: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Tester",
    email: "tester@example.com",
    timestamp: 1_700_000_000,
    parents: [parent],
    refs: [],
  };
}

// A context-menu plan (the NavIntent path) keeps the log's newest-first order,
// so the plan reads third → second → first.
const commits = [
  makeCommit("c".repeat(40), "feat: third", "b".repeat(40)),
  makeCommit("b".repeat(40), "feat: second", "a".repeat(40)),
  makeCommit("a".repeat(40), "feat: first", "0".repeat(40)),
];

const ROW_H = 36;
const GAP = 4;
const PITCH = ROW_H + GAP;

function seed(): void {
  useRepoStore.setState({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: IDLE,
    activity: {},
  });
  useNavStore.setState({
    intent: {
      kind: "rebase-plan",
      plan: commits.map((c) => ({ oid: c.oid, action: "Pick", message: null })),
    },
  });
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => IDLE);
}

const subjects = () =>
  Array.from(document.querySelectorAll('[data-testid="rebase-row"]')).map((r) =>
    r.textContent?.replace(/\s+/g, " ").trim(),
  );

/** Give every plan row a real box so the drag can resolve an index. */
function stubGeometry(): HTMLElement[] {
  const wrappers = Array.from(
    document.querySelectorAll<HTMLElement>("[data-pg-plan-row]"),
  );
  wrappers.forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({
        top: i * PITCH,
        bottom: i * PITCH + ROW_H,
        height: ROW_H,
        left: 0,
        right: 400,
        width: 400,
        x: 0,
        y: i * PITCH,
        toJSON: () => ({}),
      }) as DOMRect;
  });
  return wrappers;
}

// jsdom has no PointerEvent, and Testing Library then falls back to a bare
// Event — which silently drops clientY/button. A MouseEvent typed as a pointer
// event keeps the coordinates React's onPointerDown needs.
function pointer(type: string, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
}

function grabAndDrop(row: HTMLElement, dy: number): void {
  const grip = row.querySelector('[data-testid="rebase-row"]')!;
  fireEvent(grip, pointer("pointerdown", ROW_H / 2));
  fireEvent(window, pointer("pointermove", ROW_H / 2 + dy));
  fireEvent(window, pointer("pointerup", ROW_H / 2 + dy));
}

describe("rebase plan reordering", () => {
  beforeEach(seed);

  it("moves a row down with the chevron button", async () => {
    render(<RebaseScreen />);
    await waitFor(() => expect(subjects().length).toBe(3));
    expect(subjects()[0]).toContain("feat: third");

    // Each row carries [chevronUp, chevronDown]; the first row's down button.
    const buttons = screen
      .getAllByTestId("rebase-row")[0]
      .parentElement!.parentElement!.querySelectorAll("button");
    await userEvent.click(buttons[1]);

    await waitFor(() => expect(subjects()[0]).toContain("feat: second"));
    expect(subjects()[1]).toContain("feat: third");
  });

  it("drags the first row past the second and commits the new order", async () => {
    render(<RebaseScreen />);
    await waitFor(() => expect(subjects().length).toBe(3));
    const rows = stubGeometry();

    // Just past one pitch clears row 2's midpoint → insert at index 1.
    grabAndDrop(rows[0], PITCH + 2);

    await waitFor(() => expect(subjects()[0]).toContain("feat: second"));
    expect(subjects()[1]).toContain("feat: third");
    expect(subjects()[2]).toContain("feat: first");
  });

  it("leaves the order alone when the drag never clears a midpoint", async () => {
    render(<RebaseScreen />);
    await waitFor(() => expect(subjects().length).toBe(3));
    const rows = stubGeometry();

    grabAndDrop(rows[0], 6);

    await waitFor(() => expect(subjects()[0]).toContain("feat: third"));
    expect(subjects()[1]).toContain("feat: second");
  });

  it("ignores a drag that starts on the action select", async () => {
    render(<RebaseScreen />);
    await waitFor(() => expect(subjects().length).toBe(3));
    const rows = stubGeometry();

    const select = rows[0].querySelector("select")!;
    fireEvent(select, pointer("pointerdown", ROW_H / 2));
    fireEvent(window, pointer("pointermove", ROW_H / 2 + PITCH + 2));
    fireEvent(window, pointer("pointerup", ROW_H / 2 + PITCH + 2));

    await waitFor(() => expect(subjects()[0]).toContain("feat: third"));
  });
});
