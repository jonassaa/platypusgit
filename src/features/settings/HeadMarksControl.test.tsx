// The Settings control: toggling marks, the weight knob, and the live preview.
//
// The preview is the whole reason this control exists rather than a select, so
// it is worth a test: it must show the marks on its HEAD row and NOT on the
// ordinary row below it, or it teaches the user the wrong thing.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HeadMarksControl } from "./HeadMarksControl";
import { useSettingsStore } from "./useSettingsStore";

const marks = () => useSettingsStore.getState().headMarks;
const previewRows = () =>
  screen
    .getByTestId("head-marks-preview")
    .querySelectorAll<HTMLElement>('[data-testid="commit-row"]');

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().set("headMarks", ["bar", "tint", "ring"]);
  useSettingsStore.getState().set("headWeight", "strong");
});

describe("HeadMarksControl", () => {
  it("toggles a mark on and back off", async () => {
    const user = userEvent.setup();
    render(<HeadMarksControl />);

    await user.click(screen.getByTestId("head-mark-badge"));
    expect(marks()).toContain("badge");

    await user.click(screen.getByTestId("head-mark-badge"));
    expect(marks()).not.toContain("badge");
  });

  it("stores marks in catalog order however they are clicked", async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().set("headMarks", []);
    render(<HeadMarksControl />);

    // Clicked back-to-front on purpose.
    await user.click(screen.getByTestId("head-mark-ring"));
    await user.click(screen.getByTestId("head-mark-bar"));
    expect(marks()).toEqual(["bar", "ring"]);
  });

  it("switches weight and says what the choice means", async () => {
    const user = userEvent.setup();
    render(<HeadMarksControl />);

    await user.click(screen.getByRole("button", { name: "Intense" }));
    expect(useSettingsStore.getState().headWeight).toBe("intense");
    expect(screen.getByTestId("head-weight-hint")).toHaveTextContent(/readable/i);
  });

  it("previews the marks on the HEAD row only", async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().set("headMarks", ["badge"]);
    render(<HeadMarksControl />);

    const [headRow, plainRow] = previewRows();
    expect(headRow.querySelector('[data-testid="commit-head-badge"]')).not.toBeNull();
    expect(plainRow.querySelector('[data-testid="commit-head-badge"]')).toBeNull();

    // …and the preview tracks the controls live, not just at mount.
    await user.click(screen.getByTestId("head-mark-bar"));
    expect(
      previewRows()[0].querySelector('[data-testid="commit-head-bar"]'),
    ).not.toBeNull();
  });

  it("previews a bare row when every mark is off", async () => {
    useSettingsStore.getState().set("headMarks", []);
    render(<HeadMarksControl />);

    const headRow = previewRows()[0];
    expect(headRow.querySelector('[data-testid="commit-head-bar"]')).toBeNull();
    expect(headRow.querySelector("[data-graph-head]")).toBeNull();
    expect(headRow.style.background).toBe("");
  });
});
