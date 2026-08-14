// The LFS panel (#93).
//
// What matters most is the disabled state. A machine without `git-lfs` on a repo
// that needs it is the single most likely encounter with this feature, and it has to
// read as "install this" rather than as git's `'lfs' is not a git command` in an
// error banner.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LfsPanel } from "./LfsPanel";
import { useLfsStore } from "./useLfsStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { LfsStatus } from "@/lib/types";

function status(over: Partial<LfsStatus> = {}): LfsStatus {
  return {
    installed: true,
    version: "git-lfs/3.5.1 (GitHub; darwin arm64)",
    inUse: true,
    patterns: ["*.psd", "*.bin"],
    files: [
      { path: "art/a.psd", oid: "1111", materialized: true },
      { path: "art/b.psd", oid: "2222", materialized: false },
    ],
    ...over,
  };
}

async function setup(s: LfsStatus) {
  mockInvoke("lfs_status", () => s);
  mockInvoke("lfs_fetch", () => undefined);
  mockInvoke("lfs_pull", () => undefined);
  mockInvoke("lfs_checkout", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("repo_state", () => "Clean");
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
  } as never);
  useLfsStore.setState({ status: null, busy: null, error: null, loading: false });
  render(<LfsPanel />);
  await waitFor(() =>
    expect(screen.getByTestId("lfs-panel").getAttribute("data-in-use")).toBe(
      s.inUse ? "1" : "0",
    ),
  );
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("LfsPanel", () => {
  beforeEach(() => {
    resetInvokeMock();
    vi.clearAllMocks();
  });

  it("reports the version, the patterns and the materialized split", async () => {
    await setup(status());
    expect(screen.getByText(/git-lfs\/3\.5\.1/)).toBeInTheDocument();
    expect(screen.getByText("2 tracked patterns")).toBeInTheDocument();
    expect(screen.getByTestId("lfs-counts").textContent).toContain(
      "1 materialized",
    );
    expect(screen.getByTestId("lfs-counts").textContent).toContain("1 pointer");
    expect(screen.queryByTestId("lfs-disabled-reason")).toBeNull();
  });

  it("fetches, pulls and checks out", async () => {
    await setup(status());
    fireEvent.click(screen.getByTestId("lfs-fetch"));
    await waitFor(() => expect(calls("lfs_fetch")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("lfs-pull"));
    await waitFor(() => expect(calls("lfs_pull")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("lfs-checkout"));
    await waitFor(() => expect(calls("lfs_checkout")).toHaveLength(1));
  });

  it("disables everything and says to install it when the binary is missing", async () => {
    await setup(status({ installed: false, version: null, files: [] }));
    expect(screen.getByTestId("lfs-panel").getAttribute("data-installed")).toBe(
      "0",
    );
    expect(screen.getByText("git-lfs not installed")).toBeInTheDocument();
    for (const id of ["lfs-fetch", "lfs-pull", "lfs-checkout"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId("lfs-disabled-reason").textContent).toBe(
      "git-lfs is not installed",
    );
    // The remedy, and only for a repository that actually needs it.
    expect(screen.getByTestId("lfs-install-hint").textContent).toContain(
      "git lfs install",
    );
  });

  it("does not nag about installing on a repository that does not use LFS", async () => {
    await setup(
      status({ installed: false, version: null, inUse: false, patterns: [], files: [] }),
    );
    expect(screen.queryByTestId("lfs-install-hint")).toBeNull();
    expect(
      screen.getByText("not used by this repository"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("lfs-disabled-reason").textContent).toBe(
      "git-lfs is not installed",
    );
  });

  it("disables the actions on an LFS-less repository even with the binary present", async () => {
    await setup(status({ inUse: false, patterns: [], files: [] }));
    expect(screen.getByTestId("lfs-pull")).toBeDisabled();
    expect(screen.getByTestId("lfs-disabled-reason").textContent).toBe(
      "This repository does not use LFS",
    );
  });

  it("shows a failed transfer inline rather than losing the panel", async () => {
    await setup(status());
    mockInvoke("lfs_pull", () => {
      throw { kind: "Network", message: "lfs server said no" };
    });
    fireEvent.click(screen.getByTestId("lfs-pull"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "lfs server said no",
      ),
    );
    expect(screen.getByTestId("lfs-panel")).toBeInTheDocument();
  });
});
