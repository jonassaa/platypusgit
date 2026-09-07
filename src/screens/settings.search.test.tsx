// Settings search: one flat list of matching rows across every page, each with
// its real working control.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { SettingsScreen } from "./Settings";

function typeSearch(text: string) {
  fireEvent.change(screen.getByTestId("settings-search"), { target: { value: text } });
}

const navRow = (pageId: string) => screen.getByTestId(`settings-nav-${pageId}`);

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  // The update capability is module-global state that SettingsScreen now
  // primes on mount, and the index reads it — so a leak from one case would
  // decide whether the next one can find "Check for updates" at all.
  useUpdateStore.setState({ capability: null });
  useSettingsStore.getState().setThemeFollowMode("fixed"); // DEFAULTS
  // Reset here, not just at the end of the test that mutates it: if that
  // test's own assertion throws first, an end-of-test reset never runs and
  // the value leaks into whichever test runs next. Resetting at the START of
  // every test means a leak from a failing test heals itself on the very next
  // one, same as the `settingsPage` reset above.
  useSettingsStore.getState().set("diffContextLines", 3); // DEFAULTS
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

// The gates, checked over the RESOLVED index — the one thing
// nav/match.test.ts structurally cannot do, because it hands `buildIndex` the
// booleans itself. `useSettingsIndex` could read either gate the wrong way
// round and every case in that file would still pass; these are what fail.
describe("settings search: the Store gate", () => {
  it("never names an update check on a Microsoft Store install", () => {
    // Store policy 10.2.5 makes NAMING an update check the violation, not just
    // performing one — v0.4.0 failed certification on a notification. A search
    // is a surface like any other: it must not offer "Check for updates" or a
    // release channel here, in the results pane or as a hit count.
    useUpdateStore.setState({ capability: "store-managed" });
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("update");
    // The page is still reachable and still answers "what version am I on".
    expect(document.querySelector('[data-setting-id="updates.version"]')).toBeTruthy();
    // Nowhere in the DOM — not a disabled control, not a hidden one.
    expect(document.querySelector('[data-setting-id="updates.check"]')).toBeNull();
    expect(document.querySelector('[data-setting-id="updates.channel"]')).toBeNull();
    // The COUNT is the load-bearing assertion in this state, so do not drop
    // it as redundant: with the capability known to be store-managed,
    // `UpdatesPage` takes its own `storeManaged` branch and renders neither
    // control whatever the index says, so the two queries above pass even
    // with the index gate removed. A badge reading "3" is what leaks — and it
    // is itself a statement that this page has three update settings.
    // (The state where the index gate is the ONLY thing standing between a
    // Store install and a live "Check for updates" button is `capability ===
    // null`, which the case below covers.)
    expect(navRow("general.updates").textContent).toContain("1");
    expect(navRow("general.updates").textContent).not.toContain("3");
  });

  it("finds nothing at all when a Store install searches for the check itself", () => {
    useUpdateStore.setState({ capability: "store-managed" });
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("check for updates");
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    // No badge on Updates either — a "1" beside it would itself be a hint
    // that there is an update control on this page.
    expect(navRow("general.updates").textContent).not.toMatch(/\d/);
  });

  it("keeps the check out of search until the capability is known", () => {
    // `updatesManagedExternally(null)` is `false` — right for the Updates
    // PANEL, which would otherwise hide its controls for a frame on every
    // ordinary install. The index makes the opposite call, on purpose: a
    // Store install's capability is null for a moment after Settings opens
    // (and permanently if the probe fails, which is what this mock does), and
    // during that window an ungated index would put a live "Check for
    // updates" control in the results pane. Briefly missing a row is
    // recoverable; briefly naming a check is a certification failure.
    //
    // The test body is synchronous on purpose: `loadCapability`'s promise can
    // only settle once the call stack empties, so `capability` is still null
    // where the assertions run. The throwing mock makes that permanent rather
    // than a race.
    mockInvoke("get_update_capability", () => {
      throw new Error("probe failed");
    });
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("check for updates");
    expect(document.querySelector('[data-setting-id="updates.check"]')).toBeNull();
    expect(screen.getByText(/No settings match/)).toBeTruthy();
  });

  it("finds the check on an ordinary install once the capability lands", () => {
    // The other side of the trade-off above: the gate must close only while
    // the answer is unknown, and open by itself the moment it arrives — no
    // visit to the Updates page required. SettingsScreen primes
    // `loadCapability()` on mount for exactly this (the flat screen it
    // replaced primed it by always mounting `UpdatesSection`).
    mockInvoke("get_update_capability", () => "self-update");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("check for updates");
    return waitFor(() =>
      expect(document.querySelector('[data-setting-id="updates.check"]')).toBeTruthy(),
    );
  });
});

describe("settings search: the theme-mode gates", () => {
  // Appearance's light/dark pair and its single theme picker are mutually
  // exclusive in the DOM. While they were declared ungated the index described
  // all three at once, so a fresh install (mode "fixed") searching "light
  // theme" got "1 result" over a card with a header and no rows under it.
  it("reports no hit for a row the current theme mode cannot render", () => {
    useSettingsStore.getState().setThemeFollowMode("fixed");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("light theme");
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    // Specifically: no card header standing on its own.
    expect(document.querySelector('[data-settings-card="appearance"]')).toBeNull();
    expect(navRow("general.appearance").textContent).not.toMatch(/\d/);
  });

  it("counts and renders the same rows in each mode", () => {
    useSettingsStore.getState().setThemeFollowMode("fixed");
    const { unmount } = render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("theme");
    expect(document.querySelector('[data-setting-id="appearance.theme"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="appearance.light"]')).toBeNull();
    expect(document.querySelector('[data-setting-id="appearance.dark"]')).toBeNull();
    // One hit reported, one row rendered — "theme" used to claim 3.
    expect(navRow("general.appearance").textContent).toContain("1");
    unmount();

    useSettingsStore.getState().setThemeFollowMode("system");
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("theme");
    expect(document.querySelector('[data-setting-id="appearance.light"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="appearance.dark"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="appearance.theme"]')).toBeNull();
    expect(navRow("general.appearance").textContent).toContain("2");
  });
});
