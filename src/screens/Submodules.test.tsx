// The Submodules screen (#93). Before it, a repository with submodules said
// nothing about them at all, so what these tests pin is that each state offers the
// action that state actually needs — Init only where there is nothing checked out,
// Update everywhere, and the recorded-vs-checked-out shas only where they differ.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubmodulesScreen } from "./Submodules";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSubmodulesStore } from "@/features/submodules/useSubmodulesStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import type { SubmoduleInfo } from "@/lib/types";

const RECORDED = "1111111111111111111111111111111111111111";
const CHECKED_OUT = "2222222222222222222222222222222222222222";

function sub(over: Partial<SubmoduleInfo> = {}): SubmoduleInfo {
  return {
    name: "vendor/lib",
    path: "vendor/lib",
    url: "https://example.com/lib.git",
    branch: null,
    headOid: RECORDED,
    workdirOid: RECORDED,
    state: "UpToDate",
    ...over,
  };
}

function wire(items: SubmoduleInfo[]) {
  mockInvoke("list_submodules", () => items);
  mockInvoke("submodule_init", () => undefined);
  mockInvoke("submodule_sync", () => undefined);
  mockInvoke("submodule_update", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("bisect_status", () => ({
    inProgress: false,
    startRef: null,
    badTerm: "bad",
    goodTerm: "good",
    currentOid: null,
    remaining: null,
    steps: null,
    firstBadOid: null,
    goodCount: 0,
    badCount: 0,
    skippedCount: 0,
  }));
}

async function setup(items: SubmoduleInfo[]) {
  wire(items);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
  } as never);
  useSubmodulesStore.setState({ items: [], busy: null, error: null });
  render(
    <WithDialogs>
      <SubmodulesScreen />
    </WithDialogs>,
  );
  if (items.length) {
    await waitFor(() =>
      expect(screen.queryAllByTestId("submodule-row").length).toBe(items.length),
    );
  }
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);
const row = (path: string) =>
  screen.getByTestId("submodule-row").closest("[data-path]")?.getAttribute("data-path") ===
  path;

describe("SubmodulesScreen", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    vi.clearAllMocks();
  });

  it("says so when the repository declares none", async () => {
    await setup([]);
    await waitFor(() =>
      expect(screen.getByText("No submodules")).toBeInTheDocument(),
    );
  });

  it("lists a submodule with its path, url and state", async () => {
    await setup([sub()]);
    expect(row("vendor/lib")).toBe(true);
    expect(screen.getByTestId("submodule-row").getAttribute("data-state")).toBe(
      "UpToDate",
    );
    expect(screen.getByText("up to date")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/lib.git")).toBeInTheDocument();
  });

  it("offers Init only for an uninitialized submodule", async () => {
    await setup([sub({ state: "Uninitialized", workdirOid: null })]);
    fireEvent.click(screen.getByTestId("submodule-init"));
    await waitFor(() => expect(calls("submodule_init")).toHaveLength(1));
    expect(calls("submodule_init")[0].args.path).toBe("vendor/lib");
    // Nothing on disk to open yet.
    expect(screen.getByTestId("submodule-open")).toBeDisabled();
  });

  it("hides Init once the submodule is checked out", async () => {
    await setup([sub()]);
    expect(screen.queryByTestId("submodule-init")).toBeNull();
  });

  it("shows the checked-out sha only when it differs from the recorded one", async () => {
    await setup([sub({ state: "OutOfSync", workdirOid: CHECKED_OUT })]);
    const drift = screen.getByTestId("submodule-drift");
    expect(drift.textContent).toContain(CHECKED_OUT.slice(0, 7));
    expect(screen.getByText(/recorded 1111111/)).toBeInTheDocument();
  });

  it("does not repeat the sha when it matches", async () => {
    await setup([sub()]);
    expect(screen.queryByTestId("submodule-drift")).toBeNull();
  });

  it("updates all submodules, carrying the persisted recursive toggle", async () => {
    await setup([sub(), sub({ name: "vendor/other", path: "vendor/other" })]);
    useSubmodulesStore.getState().setRecursive(true);
    fireEvent.click(screen.getByTestId("submodules-update-all"));
    await waitFor(() => expect(calls("submodule_update")).toHaveLength(1));
    const args = calls("submodule_update")[0].args;
    // No path = every submodule; `init: true` is `--init`, git's own one-shot.
    expect(args.path).toBeNull();
    expect(args.recursive).toBe(true);
    expect(args.init).toBe(true);
    useSubmodulesStore.getState().setRecursive(false);
  });

  it("syncs urls for the whole repository", async () => {
    await setup([sub()]);
    fireEvent.click(screen.getByTestId("submodules-sync-all"));
    await waitFor(() => expect(calls("submodule_sync")).toHaveLength(1));
    expect(calls("submodule_sync")[0].args.path).toBeNull();
  });

  it("surfaces a backend failure without losing the list", async () => {
    await setup([sub()]);
    mockInvoke("submodule_sync", () => {
      throw { kind: "Git", message: "sync exploded" };
    });
    fireEvent.click(screen.getByTestId("submodules-sync-all"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("sync exploded"),
    );
    expect(screen.getAllByTestId("submodule-row")).toHaveLength(1);
  });
});
