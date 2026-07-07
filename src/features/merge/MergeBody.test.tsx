import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MergeBody, type MergeBodyHandle } from "./MergeBody";
import { buildMergeModel } from "./mergeModel";
import type { ConflictSides } from "@/lib/types";

const sides: ConflictSides = {
  path: "f.txt",
  base: "one\nbase\nthree\n",
  ours: "one\nours line\nthree\n",
  theirs: "one\ntheirs line\nthree\n",
  binary: false,
};

function renderBody() {
  const model = buildMergeModel(sides)!;
  const onRegionsChange = vi.fn();
  const ref = React.createRef<MergeBodyHandle>();
  render(<MergeBody ref={ref} model={model} onRegionsChange={onRegionsChange} />);
  return { ref, onRegionsChange };
}

describe("MergeBody", () => {
  it("renders both side panes and the result editor", () => {
    renderBody();
    expect(screen.getByText("YOURS")).toBeInTheDocument();
    expect(screen.getByText("THEIRS")).toBeInTheDocument();
    expect(screen.getByTestId("merge-result")).toBeInTheDocument();
    expect(screen.getByText("ours line")).toBeInTheDocument();
    expect(screen.getByText("theirs line")).toBeInTheDocument();
  });

  it("ours chevron accepts ours into the result", async () => {
    const { ref, onRegionsChange } = renderBody();
    await userEvent.click(screen.getByTestId("accept-chevron-ours-0"));
    expect(ref.current!.resultText()).toBe("one\nours line\nthree");
    expect(ref.current!.regions()[0].resolution).toBe("ours");
    expect(onRegionsChange).toHaveBeenCalled();
  });

  it("theirs chevron disabled after resolution", async () => {
    renderBody();
    await userEvent.click(screen.getByTestId("accept-chevron-ours-0"));
    expect(screen.getByTestId("accept-chevron-theirs-0")).toBeDisabled();
  });

  it("imperative accept('both') works through the handle", () => {
    const { ref } = renderBody();
    ref.current!.accept(0, "both");
    expect(ref.current!.resultText()).toBe("one\nours line\ntheirs line\nthree");
  });
});
