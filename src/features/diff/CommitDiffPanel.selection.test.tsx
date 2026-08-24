// CommitDiffPanel is the fourth diff surface and the only one with its own row
// markup (the other three go through PGDiffRow). The selection contract is the
// same one src/design/diffSelection.test.tsx pins for those: the code is
// selectable, the +/- marker is not, so a copied block pastes as source.
//
// This panel has no line-number gutter, so its marker is the whole of its
// chrome — and it used to be a bare text node inside the row, which a selection
// would have swept up.
import { beforeEach, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { resetInvokeMock } from "@/test/invokeMock";
import { selectionText } from "@/test/selectionText";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

const diffs: FileDiff[] = [
  {
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx line" },
          { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "removed line" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "added line" },
        ],
      },
    ],
  },
];

beforeEach(() => {
  resetInvokeMock();
});

async function renderPanel(paneIdPrefix: string) {
  const r = render(
    <CommitDiffPanel
      diffs={diffs}
      loading={false}
      error={null}
      header="x → y"
      paneIdPrefix={paneIdPrefix}
    />,
  );
  await waitFor(() =>
    expect(r.container.querySelectorAll("[data-hunk-index]").length).toBe(1),
  );
  return r;
}

describe("CommitDiffPanel selection", () => {
  it("makes each row's code text selectable", async () => {
    const { container } = await renderPanel("sel1");
    expect(
      [...container.querySelectorAll(".pg-selectable")].map((el) => el.textContent),
    ).toEqual(["ctx line", "removed line", "added line"]);
  });

  it("copies the code and none of the +/- markers", async () => {
    const { container } = await renderPanel("sel2");
    const copied = selectionText(container);
    expect(copied).toContain("removed line");
    expect(copied).toContain("added line");
    expect(copied).not.toContain("-removed");
    expect(copied).not.toContain("+added");
  });

  it("still shows the marker on screen", async () => {
    const { container } = await renderPanel("sel3");
    expect(container.textContent).toContain("-removed line");
    expect(container.textContent).toContain("+added line");
  });
});
