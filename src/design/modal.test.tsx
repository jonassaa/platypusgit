import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PGModal } from "./modal";

describe("PGModal", () => {
  it("renders children inside a role=dialog, aria-modal container", () => {
    render(
      <PGModal onCancel={() => {}}>
        <div>hello modal</div>
      </PGModal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal");
    expect(screen.getByText("hello modal")).toBeInTheDocument();
  });

  it("calls onCancel when the backdrop itself is clicked", () => {
    const onCancel = vi.fn();
    render(
      <PGModal onCancel={onCancel}>
        <div>content</div>
      </PGModal>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when a click lands inside the panel", () => {
    const onCancel = vi.fn();
    render(
      <PGModal onCancel={onCancel}>
        <div>content</div>
      </PGModal>,
    );
    fireEvent.click(screen.getByText("content"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores backdrop clicks entirely when dismissable is false", () => {
    const onCancel = vi.fn();
    render(
      <PGModal onCancel={onCancel} dismissable={false}>
        <div>content</div>
      </PGModal>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
