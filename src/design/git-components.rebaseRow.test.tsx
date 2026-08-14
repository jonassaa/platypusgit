import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PGRebaseRow } from "./git-components";

describe("PGRebaseRow", () => {
  it("offers the full action list by default and reports exact action names", async () => {
    const onActionChange = vi.fn();
    render(
      <PGRebaseRow
        sha="abc1234"
        subject="feat: thing"
        action="Pick"
        onActionChange={onActionChange}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(
      [...select.querySelectorAll("option")].map((o) => o.getAttribute("value")),
    ).toEqual(["Pick", "Reword", "Edit", "Squash", "Fixup", "Drop"]);
    await userEvent.selectOptions(select, "Drop");
    expect(onActionChange).toHaveBeenCalledWith("Drop");
  });

  it("restricts the list and shows a badge for a merge row", () => {
    render(
      <PGRebaseRow
        sha="def5678"
        subject="Merge branch 'feature'"
        action="Drop"
        badge="merge"
        options={["Drop", "MainlinePick"]}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(
      [...select.querySelectorAll("option")].map((o) => o.getAttribute("value")),
    ).toEqual(["Drop", "MainlinePick"]);
    expect(screen.getByTestId("rebase-row-badge").textContent).toBe("merge");
  });
});
