import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette } from "./CommandPalette";
import { usePaletteStore } from "./usePaletteStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke } from "@/test/invokeMock";
import type { BranchInfo, CommitInfo } from "@/lib/types";

// Result labels render matched chars inside emphasized <span>s, so a label's
// text is split across child nodes. Match on the row's combined textContent.
const rowText = (label: string) => (_content: string, el: Element | null) =>
  el?.getAttribute("data-pal-index") != null && el.textContent?.includes(label) === true;

const mkBranch = (name: string, isHead = false): BranchInfo => ({
  name,
  isHead,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: null,
});

const mkCommit = (oid: string, summary: string): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "",
  timestamp: 0,
  parents: [],
  refs: [],
});

function resetStores() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
  });
  useNavStore.setState({ intent: null });
  usePaletteStore.setState({ open: false, query: "" });
  localStorage.clear();
}

describe("CommandPalette", () => {
  beforeEach(() => {
    resetStores();
    mockInvoke("list_all_files", () => []);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows command results when opened", async () => {
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // Default commands are always present.
    expect(screen.getByText("Go to History")).toBeTruthy();
  });

  it("filters by query and fires switch-screen intent on Enter", async () => {
    const user = userEvent.setup();
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(
      /Search branches, files, commits, commands/i,
    );
    await user.click(input);
    await user.keyboard("History");

    await waitFor(() => expect(screen.getByText(rowText("Go to History"))).toBeTruthy());

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      const intent = useNavStore.getState().intent;
      expect(intent).toEqual({ kind: "switch-screen", screen: "history" });
    });
    // Palette closes after activating.
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it("checks out a branch on selection", async () => {
    const user = userEvent.setup();
    let checkedOut: string | null = null;
    useRepoStore.setState({
      branches: [mkBranch("main", true), mkBranch("feature/x")],
      checkoutBranch: async (name: string) => {
        checkedOut = name;
      },
    });
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(/Search branches/i);
    await user.click(input);
    await user.keyboard("featurex");

    const row = await screen.findByText(rowText("feature/x"));
    await user.click(row);

    await waitFor(() => expect(checkedOut).toBe("feature/x"));
  });

  it("fires a commit-vs-wt intent for a commit", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({
      commits: [mkCommit("abcdef1234", "Fix the bug")],
    });
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(/Search branches/i);
    await user.click(input);
    await user.keyboard("Fix the bug");

    const row = await screen.findByText(rowText("Fix the bug"));
    await user.click(row);

    await waitFor(() => {
      expect(useNavStore.getState().intent).toEqual({
        kind: "commit-vs-wt",
        oid: "abcdef1234",
      });
    });
  });

  it("emphasizes the matched characters in a result label", async () => {
    const user = userEvent.setup();
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(/Search branches/i);
    await user.click(input);
    await user.keyboard("History");

    const row = await screen.findByText(rowText("Go to History"));
    // The matched chars ("History") render inside an emphasized <span> using
    // the accent color, so the label is split across child nodes.
    const emphasized = Array.from(row.querySelectorAll("span")).filter((s) =>
      (s.getAttribute("style") ?? "").includes("--color-accent"),
    );
    expect(emphasized.length).toBeGreaterThan(0);
    expect(emphasized.map((s) => s.textContent).join("")).toContain("History");
  });

  it("traps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    const dialog = await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(/Search branches/i);
    await user.click(input);
    await user.keyboard("{Tab}");
    // Focus must remain within the dialog rather than escaping to <body>.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(/Search branches/i);
    await user.click(input);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false));
  });
});
