// PGCommitRow reports its own identity, so callers pass ONE stable handler pair
// instead of a fresh closure per row (#68 G9).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PGCommitRow, PGGraphRow } from "./git-components";

const base = { graphW: 0, sha: "abc1234", message: "m", author: "a", date: "d" };

describe("PGCommitRow row callbacks", () => {
  it("hands its oid to a shared click handler", () => {
    const onRowClick = vi.fn();
    const { getByTestId } = render(
      <PGCommitRow {...base} oid="deadbeef" onRowClick={onRowClick} />,
    );
    fireEvent.click(getByTestId("commit-row"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]![0]).toBe("deadbeef");
  });

  it("hands its oid to a shared context handler", () => {
    const onRowContext = vi.fn();
    const { getByTestId } = render(
      <PGCommitRow {...base} oid="deadbeef" onRowContext={onRowContext} />,
    );
    fireEvent.contextMenu(getByTestId("commit-row"));
    expect(onRowContext.mock.calls[0]![0]).toBe("deadbeef");
  });

  it("stays inert when no handlers are supplied", () => {
    const { getByTestId } = render(<PGCommitRow {...base} />);
    expect(() => fireEvent.click(getByTestId("commit-row"))).not.toThrow();
  });
});

describe("row memoization (#68 G9)", () => {
  // Asserting the memo marker rather than "the DOM node was reused": React
  // reuses DOM nodes on re-render whether or not a component is memoized, so a
  // node-identity test passes vacuously and proves nothing. The marker is the
  // actual mechanism, and it genuinely fails before the change.
  const MEMO = Symbol.for("react.memo");

  it("wraps PGCommitRow in React.memo", () => {
    expect((PGCommitRow as unknown as { $$typeof: symbol }).$$typeof).toBe(MEMO);
  });

  it("wraps PGGraphRow in React.memo", () => {
    expect((PGGraphRow as unknown as { $$typeof: symbol }).$$typeof).toBe(MEMO);
  });

  it("still re-renders when its own props change", () => {
    // The other half of the contract: memo must not be so aggressive that a
    // real prop change is swallowed.
    const { getByTestId, rerender } = render(
      <PGCommitRow {...base} message="before" />,
    );
    expect(getByTestId("commit-row").textContent).toContain("before");
    rerender(<PGCommitRow {...base} message="after" />);
    expect(getByTestId("commit-row").textContent).toContain("after");
  });
});
