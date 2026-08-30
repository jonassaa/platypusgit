import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ShallowNotice } from "./ShallowNotice";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

function openRepo() {
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "r1", path: "/tmp/r1", head: "main" },
  });
}

/** Everything `refreshAll` reads, so the post-unshallow refresh can run. */
function mockRefreshAll(shallow: boolean) {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("bisect_status", () => null);
  mockInvoke("head_info", () => null);
  mockInvoke("shallow_info", () => ({
    shallow,
    boundaryCount: shallow ? 1 : 0,
    singleBranch: false,
  }));
}

describe("ShallowNotice", () => {
  beforeEach(() => {
    openRepo();
  });

  it("renders nothing for a repository with nothing missing", () => {
    const { container } = render(<ShallowNotice surface="history" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the history is truncated and offers to fetch the rest", () => {
    useRepoStore.setState({
      shallowInfo: { shallow: true, boundaryCount: 2, singleBranch: false },
    });
    render(<ShallowNotice surface="history" />);

    expect(screen.getByTestId("shallow-notice")).toHaveTextContent(
      "Shallow clone",
    );
    expect(screen.getByTestId("shallow-notice")).toHaveTextContent(
      "stops at 2 commits",
    );
    expect(screen.getByTestId("shallow-unshallow")).toBeEnabled();
  });

  it("drops the button for a single-branch clone that is not shallow", () => {
    useRepoStore.setState({
      shallowInfo: { shallow: false, boundaryCount: 0, singleBranch: true },
    });
    render(<ShallowNotice surface="compare" />);

    expect(screen.getByTestId("shallow-notice")).toHaveTextContent(
      "Single-branch clone",
    );
    expect(screen.queryByTestId("shallow-unshallow")).toBeNull();
  });

  it("runs the unshallow and comes down once the history has arrived", async () => {
    // The whole point of reading the state on every refresh: the strip has to
    // disappear on its own, or the user is told their repository is truncated
    // while the missing commits sit right there behind the notice.
    useRepoStore.setState({
      shallowInfo: { shallow: true, boundaryCount: 1, singleBranch: false },
    });
    mockRefreshAll(false);
    mockInvoke("unshallow", () => true);
    render(<ShallowNotice surface="history" />);

    fireEvent.click(screen.getByTestId("shallow-unshallow"));

    await waitFor(() => expect(calls("unshallow")).toHaveLength(1));
    expect(calls("unshallow")[0].args.repoId).toBe("r1");
    await waitFor(() =>
      expect(screen.queryByTestId("shallow-notice")).toBeNull(),
    );
  });

  it("disables the button while a fetch is running", () => {
    // `unshallow` files itself under the `fetch` activity key, so this is also
    // what keeps a second click from queueing a second `--unshallow` behind the
    // first — the slowest wait in the app.
    useRepoStore.setState({
      shallowInfo: { shallow: true, boundaryCount: 1, singleBranch: false },
      activity: { fetch: { label: "Fetching full history…", startedAt: 1 } },
    });
    render(<ShallowNotice surface="history" />);

    expect(screen.getByTestId("shallow-unshallow")).toBeDisabled();
  });

  it("reports a failure through the repo store's error banner", async () => {
    useRepoStore.setState({
      shallowInfo: { shallow: true, boundaryCount: 1, singleBranch: false },
    });
    mockRefreshAll(true);
    mockInvoke("unshallow", () => {
      throw { kind: "Network", message: "could not resolve host" };
    });
    render(<ShallowNotice surface="history" />);

    fireEvent.click(screen.getByTestId("shallow-unshallow"));

    await waitFor(() =>
      expect(useRepoStore.getState().error).toMatchObject({ kind: "Network" }),
    );
    // And the notice stays up: nothing arrived.
    expect(screen.getByTestId("shallow-notice")).toBeInTheDocument();
  });
});
