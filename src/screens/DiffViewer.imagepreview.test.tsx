// A changed image is no longer a dead end in the DiffViewer (#224).
//
// The per-surface WIRING, not the preview's own rules — those are asserted once
// in `features/diff/ImageDiffView.test.tsx`. What this pins is that this screen
// hands the shared component the same two sides its syntax hook reads (HEAD vs
// the worktree), and that a binary which is NOT an image still gets the empty
// state it always had.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiffViewerScreen } from "./DiffViewer";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const modified = (path: string): FileStatus =>
  ({
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  }) as unknown as FileStatus;

const binaryDiff = (path: string) => ({
  path,
  oldPath: null,
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
});

function setup(path: string) {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [modified(path)],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_status", () => [modified(path)]);
  mockInvoke("get_diff", () => binaryDiff(path));
  // The syntax hook fires for every selection; a binary blob has no text.
  mockInvoke("read_file_content", () => null);
  mockInvoke("read_file_content_at_rev", () => null);
}

describe("DiffViewer, binary file", () => {
  beforeEach(() => resetInvokeMock());

  it("previews a changed image instead of the empty state", async () => {
    setup("logo.png");
    mockInvoke("read_image_preview", (args) => ({
      kind: "image",
      path: "logo.png",
      mediaType: "image/png",
      size: (args.source as { kind: string }).kind === "rev" ? 1024 : 4096,
      data: "AAAA",
    }));
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );

    await screen.findByTestId("image-preview-old");
    expect(screen.getByTestId("image-preview-new")).toBeInTheDocument();
    // The sentence this feature exists to replace must be gone.
    expect(screen.queryByText("Binary file")).toBeNull();
  });

  it("asks for the same two sides the syntax hook reads — HEAD and the worktree", async () => {
    setup("logo.png");
    mockInvoke("read_image_preview", () => null);
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );

    await waitFor(() =>
      expect(
        getInvokeCalls().filter((c) => c.cmd === "read_image_preview").length,
      ).toBe(2),
    );
    expect(
      getInvokeCalls()
        .filter((c) => c.cmd === "read_image_preview")
        .map((c) => c.args.source),
    ).toEqual([{ kind: "rev", revspec: "HEAD" }, { kind: "worktree" }]);
  });

  it("keeps the empty state for a binary that is not an image", async () => {
    // PDFs, fonts and archives are explicitly out of scope (#224).
    setup("doc.pdf");
    mockInvoke("read_image_preview", () => ({
      kind: "unsupported",
      path: "doc.pdf",
      size: 900,
      reason: "notAnImage",
    }));
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );

    // BOTH conditions inside ONE `waitFor`, and neither is optional.
    //
    // The count alone is not enough, and waiting on it and then asserting the
    // DOM separately is what made this flaky: `getInvokeCalls()` records a call
    // when it is DISPATCHED, so "both reads issued" is not "both results
    // rendered". Under CI load the assertions ran while the resolving preview's
    // state update had not been flushed and the pane was mid-swap — "Unable to
    // find an element with the text: Binary file", green locally, red in CI.
    //
    // The DOM alone is not enough either, in the other direction: this pane
    // renders `title="Binary file"` WHILE the previews are still loading, so a
    // bare wait on that text passes immediately, before either read has landed,
    // and would keep passing if the preview were broken outright.
    //
    // Retrying both together is also what fixes the older detached-node bug
    // (`expect(await findByText(...))` held a node across a re-render): every
    // poll re-queries, so no node is carried over.
    await waitFor(() => {
      expect(
        getInvokeCalls().filter((c) => c.cmd === "read_image_preview").length,
      ).toBe(2);
      expect(screen.getByText("Binary file")).toBeInTheDocument();
      expect(screen.queryByTestId("image-diff")).toBeNull();
    });
  });
});
