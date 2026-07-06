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
    // Empty query shows home screen — Quick actions section is visible.
    expect(screen.getByText("Quick actions")).toBeTruthy();
  });

  it("renders live keymap chord chips on command rows", async () => {
    const user = userEvent.setup();
    const { useKeymapStore } = await import("@/features/keymap");
    useKeymapStore.getState().setPreset("rider");
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(
      /Search branches, files, commits, commands/i,
    );
    await user.click(input);
    await user.keyboard("Go to Files");

    await waitFor(() => expect(screen.getByText(rowText("Go to Files"))).toBeTruthy());
    const row = screen.getByText(rowText("Go to Files"));
    const chip = row.querySelector("[data-pal-chord]");
    // jsdom isn't mac → non-mac formatting of Mod+1.
    expect(chip?.textContent).toBe("Ctrl+1");
  });

  it("chord chips follow the active preset", async () => {
    const user = userEvent.setup();
    const { useKeymapStore } = await import("@/features/keymap");
    useKeymapStore.getState().setPreset("rider");
    usePaletteStore.setState({ open: true, query: "" });
    render(<CommandPalette />);
    await screen.findByRole("dialog");

    const input = screen.getByPlaceholderText(
      /Search branches, files, commits, commands/i,
    );
    await user.click(input);
    await user.keyboard("Go to Commit");
    await waitFor(() =>
      expect(screen.getByText(rowText("Go to Commit"))).toBeTruthy(),
    );
    // Rider: ⌘K / Ctrl+K commits.
    expect(
      screen
        .getByText(rowText("Go to Commit"))
        .querySelector("[data-pal-chord]")?.textContent,
    ).toBe("Ctrl+K");
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

  it("runs a direct command and closes (Go to Branches)", async () => {
    const user = userEvent.setup();
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await user.keyboard("Go to Branches");
    await user.keyboard("{Enter}");
    expect(useNavStore.getState().intent).toEqual({ kind: "switch-screen", screen: "branches" });
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it("merge command opens an inline branch-pick step", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await user.keyboard("Merge branch");
    await user.keyboard("{Enter}");
    // palette still open, now on a pick step titled "Merge into current"
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().stack.at(-1)?.kind).toBe("pick");
    expect(await screen.findByText("Merge into current")).toBeTruthy();
  });

  it("Escape pops a step before closing", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().pushStep({ kind: "pick", title: "T", items: [] });
    render(<CommandPalette />);
    await user.keyboard("{Escape}");
    expect(usePaletteStore.getState().open).toBe(true);  // popped to root
    await user.keyboard("{Escape}");
    expect(usePaletteStore.getState().open).toBe(false); // closed from root
  });

  it("chip filters the root list to one type", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({ branches: [mkBranch("feature-foo")] });
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    // click Branches chip — empty query already shows all items (fuzzyMatch always matches "")
    await user.click(screen.getByRole("button", { name: "Branches" }));
    expect(usePaletteStore.getState().activeChip).toBe("branch");
    // command rows should be gone; branch rows should remain
    // (palette renders into a portal on document.body, not inside render container)
    expect(document.querySelectorAll('[data-pal-type="command"]').length).toBe(0);
    expect(document.querySelectorAll('[data-pal-type="branch"]').length).toBeGreaterThan(0);
  });

  it("shows Quick actions on empty query when a branch is checked out", async () => {
    useRepoStore.setState({ branches: [mkBranch("main", true)] });
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    expect(await screen.findByText("Quick actions")).toBeTruthy();
    expect(screen.getByText(rowText("Fetch all remotes"))).toBeTruthy();
  });

  it("shows Recent items from frecency on empty query", async () => {
    const { bumpFrecency } = await import("./frecency");
    bumpFrecency("screen:history", Date.now());
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    expect(await screen.findByText("Recent")).toBeTruthy();
  });

  it("activating a direct command bumps frecency for its id", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({ remotes: [] });
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await user.keyboard("Fetch all");
    await waitFor(() => expect(screen.getByText(rowText("Fetch all remotes"))).toBeTruthy());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false));
    const { loadFrecency } = await import("./frecency");
    const f = loadFrecency();
    expect(f["action:fetch-all"]).toBeDefined();
    expect(f["action:fetch-all"].count).toBeGreaterThan(0);
  });

  it("activating a step-opener does NOT bump frecency for its id", async () => {
    const user = userEvent.setup();
    useRepoStore.setState({ branches: [mkBranch("main", true), mkBranch("feat/y")] });
    usePaletteStore.getState().openPalette();
    render(<CommandPalette />);
    await user.keyboard("Merge branch");
    await waitFor(() => expect(screen.getByText(rowText("Merge branch into current…"))).toBeTruthy());
    await user.keyboard("{Enter}");
    // palette still open (pushed a step)
    expect(usePaletteStore.getState().open).toBe(true);
    const { loadFrecency } = await import("./frecency");
    const f = loadFrecency();
    expect(f["action:merge"]).toBeUndefined();
  });
});
