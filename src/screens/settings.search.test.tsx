// Settings search: one flat list of matching rows across every page, each with
// its real working control.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

function typeSearch(text: string) {
  fireEvent.change(screen.getByTestId("settings-search"), { target: { value: text } });
}

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  mockInvoke("cli_shim_status", () => ({
    installed: true, shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit", source: "package", pathState: "onPath",
  }));
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log", logExists: false, logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0", version: "0.1.0",
  }));
  mockInvoke("get_update_capability", () => "self-update");
});

describe("settings search", () => {
  it("shows matching rows from more than one page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    // "version" hits general.updates ("Current version") AND advanced.backup
    // (diagnostics.environment's "version" keyword) — two distinct pages,
    // verified against the real page metas (`grep` for "version" across
    // src/features/settings/pages/*.tsx turns up exactly these two ids).
    typeSearch("version");
    expect(document.querySelector('[data-setting-id="updates.version"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diagnostics.environment"]')).toBeTruthy();
    // The page the user was on is no longer rendered as a page.
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeNull();
  });

  it("shows a breadcrumb for each page with hits", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("theme");
    expect(screen.getByText(/General.*Appearance/)).toBeTruthy();
  });

  it("hides rows on a hit page that do not match", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    expect(document.querySelector('[data-setting-id="diff.context"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diff.layout"]')).toBeNull();
  });

  it("badges pages with hits and dims pages without", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    const diff = screen.getByRole("treeitem", { name: /Diff/ });
    expect(diff.textContent).toContain("1");
    // Pages with no hits stay listed rather than disappearing.
    expect(screen.getByRole("treeitem", { name: /Updates/ })).toBeTruthy();
  });

  it("finds a row by a keyword its label does not contain", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("gpg");
    expect(document.querySelector('[data-setting-id="commit.sign"]')).toBeTruthy();
  });

  it("shows an empty state and clears back to the page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("zzzznope");
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear search/ }));
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
  });

  // Every other test here is presence-based — it proves a row with the right
  // id showed up, not that firing its control does anything. The whole design
  // rests on a result being the REAL row (Page renders itself under a filter
  // context, per SettingsResults), not a copy of it that could drift; this is
  // the one test that would catch a copy.
  it("firing a control rendered in the results pane mutates the store", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    const input = document.querySelector(
      '[data-setting-id="diff.context"] input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(useSettingsStore.getState().diffContextLines).toBe(3); // DEFAULTS
    fireEvent.change(input, { target: { value: "7" } });
    expect(useSettingsStore.getState().diffContextLines).toBe(7);
    useSettingsStore.getState().set("diffContextLines", 3); // leave defaults for later tests
  });

  // git.integrations' card is `dynamic: true` — its host list is data, not
  // fixed rows, so SettingsResults reveals the whole card when ANY of its
  // synthetic rows match rather than filtering row by row. That branch
  // (SettingsResults.tsx) has no other direct coverage.
  it("renders the dynamic Integrations card when a search hits its synthetic rows", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("github"); // keyword on the "Forge token" synthetic row
    expect(document.querySelector('[data-settings-card="integrations"]')).toBeTruthy();
    // No repo is open in this test, so the row ForgeSettings actually renders
    // is "No forge detected" (id integrations.none) — a DIFFERENT synthetic
    // id than the one that literally matched ("integrations.token"). Only
    // the `dynamic` branch, which reveals every declared row on the card once
    // any one of them matches, keeps this one visible.
    expect(document.querySelector('[data-setting-id="integrations.none"]')).toBeTruthy();
  });
});
