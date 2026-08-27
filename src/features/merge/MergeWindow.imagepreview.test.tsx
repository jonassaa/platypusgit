// The binary chooser's image previews (#224).
//
// The issue calls this the surface where a preview is worth the most, and it is
// right: everywhere else "Binary file" costs you a look at a picture, but here
// it costs you the ability to answer the question the two buttons are asking.
// "Take ours" and "Take theirs" over two unnamed blobs is a coin flip.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MergeWindow } from "./MergeWindow";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

function conflictedStatus(paths: string[]): FileStatus[] {
  return paths.map((path) => ({
    path,
    index: { kind: "Conflicted" },
    worktree: { kind: "Conflicted" },
  })) as unknown as FileStatus[];
}

function setSearch(params: string) {
  window.history.replaceState(null, "", `/?${params}`);
}

/** libgit2 reports every side as null for a binary conflict — hence the stages. */
function binarySides(path: string) {
  return { path, base: null, ours: null, theirs: null, binary: true };
}

describe("a conflicted image", () => {
  it("previews both stages above the chooser, and keeps the buttons", async () => {
    setSearch("window=merge&repoId=r1&path=logo.png");
    mockInvoke("get_status", () => conflictedStatus(["logo.png"]));
    mockInvoke("conflict_sides", () => binarySides("logo.png"));
    mockInvoke("read_image_preview", (args) => ({
      kind: "image",
      path: "logo.png",
      mediaType: "image/png",
      size: (args.source as { stage: number }).stage === 2 ? 1024 : 2048,
      data: (args.source as { stage: number }).stage === 2 ? "T1VSUw" : "VEhFSVJT",
    }));
    render(<MergeWindow />);

    const ours = (await screen.findByTestId("image-preview-ours")) as HTMLImageElement;
    const theirs = screen.getByTestId("image-preview-theirs") as HTMLImageElement;
    expect(ours.getAttribute("src")).toBe("data:image/png;base64,T1VSUw");
    expect(theirs.getAttribute("src")).toBe("data:image/png;base64,VEhFSVJT");
    // The previews are an ADDITION to the chooser, not a replacement: these two
    // buttons remain the only way to resolve a binary conflict.
    expect(screen.getByTestId("chooser-take-ours")).toBeInTheDocument();
    expect(screen.getByTestId("chooser-take-theirs")).toBeInTheDocument();
    expect(screen.getByTestId("merge-chooser").textContent).toContain(
      "Binary file — pick a side",
    );
  });

  it("reads the two conflict STAGES, which is the only way to name the sides", async () => {
    // Neither "ours" nor "theirs" is in any tree while the merge is unresolved.
    setSearch("window=merge&repoId=r1&path=logo.png");
    mockInvoke("get_status", () => conflictedStatus(["logo.png"]));
    mockInvoke("conflict_sides", () => binarySides("logo.png"));
    mockInvoke("read_image_preview", () => null);
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");

    await new Promise((r) => setTimeout(r, 0));
    const reads = getInvokeCalls().filter((c) => c.cmd === "read_image_preview");
    expect(reads.map((c) => c.args.source)).toEqual([
      { kind: "stage", stage: 2 },
      { kind: "stage", stage: 3 },
    ]);
  });

  it("leaves a non-image binary conflict exactly as it was", async () => {
    setSearch("window=merge&repoId=r1&path=blob.bin");
    mockInvoke("get_status", () => conflictedStatus(["blob.bin"]));
    mockInvoke("conflict_sides", () => binarySides("blob.bin"));
    mockInvoke("read_image_preview", () => ({
      kind: "unsupported",
      path: "blob.bin",
      size: 12,
      reason: "notAnImage",
    }));
    render(<MergeWindow />);

    const chooser = await screen.findByTestId("merge-chooser");
    expect(screen.queryByTestId("image-diff")).toBeNull();
    expect(chooser.textContent).toContain("Binary file — pick a side");
  });

  it("reads nothing at all for a deleted-side conflict", async () => {
    // The chooser also handles "deleted on one side", which is a TEXT conflict —
    // no bytes to preview and none should be asked for.
    setSearch("window=merge&repoId=r1&path=gone.txt");
    mockInvoke("get_status", () => conflictedStatus(["gone.txt"]));
    mockInvoke("conflict_sides", () => ({
      path: "gone.txt",
      base: "b\n",
      ours: null,
      theirs: "t\n",
      binary: false,
    }));
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");

    expect(getInvokeCalls().filter((c) => c.cmd === "read_image_preview")).toEqual([]);
  });
});
