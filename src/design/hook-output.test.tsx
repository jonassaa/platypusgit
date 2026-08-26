// PGHookOutput (#232) — the surface a rejecting hook's output lands on.
//
// The contract worth pinning is that EVERY line of a hook's output is reachable.
// A truncated diagnostic is worse than none: the user acts on what they can see
// and never learns the third error existed.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PGHookOutput } from "./hook-output";

const rejection = {
  hook: "pre-commit",
  output:
    "eslint: src/a.ts:12  no-unused-vars\neslint: src/b.ts:40  eqeqeq\n✖ 2 problems",
};

describe("PGHookOutput", () => {
  it("names the hook that refused", () => {
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    expect(screen.getByText(/pre-commit/)).toBeTruthy();
  });

  it("shows every line of the output, not a preview", () => {
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    const body = screen.getByTestId("hook-body").textContent ?? "";
    expect(body).toContain("no-unused-vars");
    expect(body).toContain("eqeqeq");
    expect(body).toContain("2 problems");
  });

  it("collapses and restores the output", async () => {
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    expect(screen.queryByTestId("hook-body")).toBeTruthy();
    await userEvent.click(screen.getByTestId("hook-toggle"));
    expect(screen.queryByTestId("hook-body")).toBeNull();
    await userEvent.click(screen.getByTestId("hook-toggle"));
    expect(screen.queryByTestId("hook-body")).toBeTruthy();
  });

  it("keeps naming the hook while collapsed", async () => {
    // Collapsing hides the output, not the reason the block is there.
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId("hook-toggle"));
    expect(screen.getByText(/pre-commit/)).toBeTruthy();
  });

  it("calls onDismiss when dismissed", async () => {
    const onDismiss = vi.fn();
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={onDismiss}
        onCommitAnyway={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId("hook-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers committing without hooks", async () => {
    const onCommitAnyway = vi.fn();
    render(
      <PGHookOutput
        rejection={rejection}
        onDismiss={() => {}}
        onCommitAnyway={onCommitAnyway}
      />,
    );
    await userEvent.click(screen.getByTestId("hook-skip"));
    expect(onCommitAnyway).toHaveBeenCalledOnce();
  });

  it("says so when the hook printed nothing", () => {
    // A hook can exit 1 in total silence. An empty box reads as a rendering
    // bug, so the block states the absence instead.
    render(
      <PGHookOutput
        rejection={{ hook: "commit-msg", output: "" }}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    expect(screen.getByText(/commit-msg/)).toBeTruthy();
    expect(screen.getByTestId("hook-body").textContent).toContain(
      "printed nothing",
    );
  });
});
