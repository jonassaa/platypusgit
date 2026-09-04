// The side menu: three groups, ten pages, one page rendered at a time.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  mockInvoke("cli_shim_status", () => ({
    installed: true, shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit", source: "package", pathState: "onPath",
  }));
});

describe("settings side menu", () => {
  it("lists all three groups and lands on the remembered page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Git")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
    // Appearance is rendered…
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
    // …and nothing else is.
    expect(document.querySelector('[data-settings-page="git.diff"]')).toBeNull();
  });

  it("switches page on click and remembers the choice", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    fireEvent.click(screen.getByRole("treeitem", { name: /Diff/ }));
    expect(document.querySelector('[data-settings-page="git.diff"]')).toBeTruthy();
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeNull();
    expect(useSettingsStore.getState().settingsPage).toBe("git.diff");
  });

  it("marks the current page selected", () => {
    useSettingsStore.getState().set("settingsPage", "git.diff");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(
      screen.getByRole("treeitem", { name: /Diff/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("falls back to the first page when the persisted id is unknown", () => {
    // Bypass the typed setter the way a hand-edited localStorage payload would.
    useSettingsStore.setState({ settingsPage: "nope.gone" as never });
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
  });

  it("moves between pages with the arrow keys", () => {
    useSettingsStore.getState().set("settingsPage", "general.appearance");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    const first = screen.getByRole("treeitem", { name: /Appearance/ });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(useSettingsStore.getState().settingsPage).toBe("general.keyboard");
  });

  it("selects a focused row with Enter or Space, same as a click", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    const diffRow = screen.getByRole("treeitem", { name: /Diff/ });
    fireEvent.keyDown(diffRow, { key: "Enter" });
    expect(useSettingsStore.getState().settingsPage).toBe("git.diff");
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /Commit/ }), { key: " " });
    expect(useSettingsStore.getState().settingsPage).toBe("git.commit");
  });

  it("collapses the enclosing group with the left arrow, and a header click reopens it", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    const appearanceRow = screen.getByRole("treeitem", { name: /Appearance/ });
    // Sibling in the same ("General") group, present while it's expanded.
    expect(screen.getByRole("treeitem", { name: /Keyboard/ })).toBeTruthy();
    fireEvent.keyDown(appearanceRow, { key: "ArrowLeft" });
    // Collapse actually hides the group's rows — not just "a handler fired".
    expect(screen.queryByRole("treeitem", { name: /Keyboard/ })).toBeNull();
    // A page in an unrelated ("Git") group is unaffected.
    expect(screen.getByRole("treeitem", { name: /Diff/ })).toBeTruthy();
    // Reopening goes through the same controlled `open` state Left/Right
    // set: SettingsNav, not PGSidebarGroup, now owns it, so a plain header
    // click (PGSidebarGroup's `onOpenChange`) must still flip it back.
    fireEvent.click(screen.getByText("General"));
    expect(screen.getByRole("treeitem", { name: /Keyboard/ })).toBeTruthy();
  });

  it("skips a collapsed group's pages entirely when moving past it with the arrow keys", () => {
    useSettingsStore.getState().set("settingsPage", "general.updates");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    // Collapse "Git" — the group immediately after the current page's group —
    // via a header click, independent of the ArrowLeft mechanism tested
    // elsewhere.
    fireEvent.click(screen.getByText("Git"));
    expect(screen.queryByRole("treeitem", { name: /Diff/ })).toBeNull();
    const updatesRow = screen.getByRole("treeitem", { name: "Updates" });
    fireEvent.keyDown(updatesRow, { key: "ArrowDown" });
    // Lands on the first page of the next OPEN group ("Advanced"), never on
    // a hidden Git page — a stale `visible` list would select "git.commit"
    // (the first Git page in registry order) even though its row is gone.
    expect(useSettingsStore.getState().settingsPage).toBe("advanced.cli");
  });

  it("keeps exactly one row tabbable after a header click collapses the selected page's group", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>); // settingsPage: general.appearance
    // Collapsing via a header click (not ArrowLeft, which already refocuses
    // the tree root itself) is what strands the roving tabindex: nothing
    // else moves focus or updates which row is tabbable.
    fireEvent.click(screen.getByText("General"));
    expect(screen.queryByRole("treeitem", { name: /Appearance/ })).toBeNull();
    const tabbableRows = screen
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbableRows).toHaveLength(1);
    // Falls back to the first row of the first remaining OPEN group ("Git").
    expect(tabbableRows[0].textContent).toContain("Commit");
  });
});
