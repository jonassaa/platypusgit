import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { pgPickOption, pgSelectValues } from "@/test/select";
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
    // The action list is an in-page listbox now (issue 146), so its values come
    // off `data-value` rather than off `<option>`s.
    const select = screen.getByRole("combobox");
    expect(pgSelectValues(select)).toEqual([
      "Pick", "Reword", "Edit", "Squash", "Fixup", "Drop",
    ]);
    pgPickOption(select, "Drop");
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
    expect(pgSelectValues(select)).toEqual(["Drop", "MainlinePick"]);
    expect(screen.getByTestId("rebase-badge").textContent).toBe("merge");
  });
});
