import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useUpdateStore } from "./useUpdateStore";
import { UpdatePanel } from "./UpdatePanel";
import { UpdateChip } from "./UpdateChip";
import type { Platform } from "@/lib/platform";
import type { UpdateInfo } from "@/lib/types";

// Mutable so BOTH platform arms are reachable. A module-level `() => "macos"`
// made the Linux/.deb notify case impossible to express, which is exactly the
// arm that shipped without a hint.
const platformMock = vi.hoisted(() => ({ value: "macos" as Platform }));
vi.mock("@/lib/platform", () => ({
  usePlatform: () => platformMock.value,
}));

const INFO: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
};

function seed(partial: Partial<ReturnType<typeof useUpdateStore.getState>>) {
  useUpdateStore.setState({
    status: "available",
    info: INFO,
    capability: "notify",
    dismissedVersion: null,
    currentVersion: "0.0.5",
    installing: false,
    progress: null,
    error: null,
    message: null,
    panelOpen: true,
    ...partial,
  });
}

describe("UpdateChip", () => {
  beforeEach(() =>
    useUpdateStore.setState({ info: null, status: "idle", panelOpen: false }),
  );

  it("is hidden when no update is available", () => {
    render(<UpdateChip />);
    expect(screen.queryByTestId("pg-update-chip")).toBeNull();
  });

  it("shows the latest version and opens the panel on click", async () => {
    seed({ panelOpen: false });
    render(<UpdateChip />);
    const chip = screen.getByTestId("pg-update-chip");
    expect(chip).toHaveTextContent("0.1.0");
    await userEvent.click(chip);
    expect(useUpdateStore.getState().panelOpen).toBe(true);
  });
});

describe("UpdatePanel — capability + platform arms", () => {
  beforeEach(() => {
    platformMock.value = "macos";
    seed({});
  });

  it("notify on macOS offers 'View release' plus the brew hint", () => {
    seed({ capability: "notify" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.getByTestId("pg-update-pkg-hint")).toHaveTextContent(
      "brew upgrade platypusgit",
    );
  });

  it("notify on Linux (sideloaded .deb) offers 'View release' AND the one-liner", () => {
    // Regression: this arm used to render no hint at all, so a .deb user got a
    // "View release" button with no hint of why in-app install was unavailable.
    //
    // Since #187 this arm means specifically a .deb that did NOT come from the
    // apt repository — telling it `apt upgrade` would report "already the newest
    // version" and dead-end again, so it gets the installer instead.
    platformMock.value = "linux";
    seed({ capability: "notify" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.getByTestId("pg-update-pkg-hint")).toHaveTextContent(
      "curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh",
    );
    expect(screen.getByText(/apt repository/i)).toBeInTheDocument();
  });

  it("notify-apt on Linux offers 'View release' AND apt upgrade", () => {
    // The third capability: the backend found the sources file this install's
    // one-liner wrote, so apt owns updates here and the panel can say so.
    platformMock.value = "linux";
    seed({ capability: "notify-apt" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.getByTestId("pg-update-pkg-hint")).toHaveTextContent(
      "sudo apt update && sudo apt upgrade platypusgit",
    );
  });

  it("notify-scoop on Windows offers 'View release' AND scoop update", () => {
    // The fourth capability, and the only one that takes a platform OFF the
    // self-update path: an in-app install here would run the per-machine .msi
    // and leave the machine with two copies, Scoop's still on PATH. So the
    // panel must show no Install button, and must name Scoop's command.
    platformMock.value = "windows";
    seed({ capability: "notify-scoop" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.getByTestId("pg-update-action")).not.toHaveTextContent(
      /install/i,
    );
    expect(screen.getByTestId("pg-update-pkg-hint")).toHaveTextContent(
      "scoop update platypusgit",
    );
  });

  it("self-update offers 'Install' and never a package-manager hint", () => {
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/install/i);
    expect(screen.queryByTestId("pg-update-pkg-hint")).toBeNull();
  });

  it("keeps the Windows .msi install self-updating", () => {
    // The other side of the Scoop case: the .msi is the one Windows install that
    // SHOULD swap its own binary, so the new variant must not have made every
    // Windows user click through to a browser.
    platformMock.value = "windows";
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/install/i);
    expect(screen.queryByTestId("pg-update-pkg-hint")).toBeNull();
  });
});

describe("UpdatePanel — visibility", () => {
  beforeEach(() => {
    platformMock.value = "macos";
    seed({});
  });

  it("hides when a later check reports the update is no longer available", () => {
    // Deleted/yanked release: the chip disappears, so the panel must too.
    seed({ info: { ...INFO, available: false } });
    render(<UpdatePanel />);
    expect(screen.queryByTestId("pg-update-panel")).toBeNull();
  });

  it("closes on a mousedown outside the panel", async () => {
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-panel")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(useUpdateStore.getState().panelOpen).toBe(false);
  });

  it("stays open on a mousedown inside the panel", async () => {
    render(<UpdatePanel />);
    await userEvent.click(screen.getByText(/Update available/));
    expect(useUpdateStore.getState().panelOpen).toBe(true);
  });
});

describe("UpdatePanel — close vs skip", () => {
  beforeEach(() => {
    platformMock.value = "macos";
    localStorage.clear();
    seed({});
  });

  it("the x closes the panel WITHOUT remembering the version", async () => {
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle("Close (ask again later)"));
    expect(useUpdateStore.getState().panelOpen).toBe(false);
    expect(useUpdateStore.getState().dismissedVersion).toBeNull();
    expect(localStorage.getItem("pg-update-dismissed")).toBeNull();
  });

  it("'Skip this version' closes AND persists the suppression", async () => {
    render(<UpdatePanel />);
    const skip = screen.getByTestId("pg-update-dismiss");
    expect(skip).toHaveTextContent(/skip this version/i);
    await userEvent.click(skip);
    expect(useUpdateStore.getState().panelOpen).toBe(false);
    expect(useUpdateStore.getState().dismissedVersion).toBe("0.1.0");
    expect(localStorage.getItem("pg-update-dismissed")).toBe("0.1.0");
  });
});

describe("UpdatePanel — status surfaces", () => {
  beforeEach(() => {
    platformMock.value = "macos";
    seed({});
  });

  it("renders a failure inline instead of silently stopping the spinner", () => {
    seed({ error: "download failed: 404" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-error")).toHaveTextContent(
      "download failed: 404",
    );
  });

  it("renders the explanatory message for a release with no signed installer", () => {
    seed({ message: "No signed installer is published for this release yet." });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-message")).toHaveTextContent(
      /no signed installer/i,
    );
  });

  it("shows download progress while installing", () => {
    seed({ capability: "self-update", installing: true, progress: 0.42 });
    render(<UpdatePanel />);
    expect(screen.getByText(/Downloading/)).toHaveTextContent("42%");
  });
});

describe("UpdatePanel — the package-manager command is copyable", () => {
  // `body` sets `user-select: none` (src/index.css), so before this the notify
  // path's command could neither be selected nor copied: the panel's only
  // actionable content had to be retyped by hand.
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    platformMock.value = "macos";
    seed({});
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies the brew command on macOS", async () => {
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle(/copy command/i));
    expect(writeText).toHaveBeenCalledWith("brew upgrade platypusgit");
  });

  it("copies the installer one-liner for a sideloaded .deb on Linux", async () => {
    // `seed({})` leaves capability at the fixture default of "notify", which on
    // Linux now means a .deb that did not come from the apt repository.
    platformMock.value = "linux";
    seed({});
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle(/copy command/i));
    expect(writeText).toHaveBeenCalledWith(
      "curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh",
    );
  });

  it("copies the apt upgrade command for an apt-managed install", async () => {
    platformMock.value = "linux";
    seed({ capability: "notify-apt" });
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle(/copy command/i));
    expect(writeText).toHaveBeenCalledWith(
      "sudo apt update && sudo apt upgrade platypusgit",
    );
  });

  it("copies the scoop update command for a Scoop install", async () => {
    platformMock.value = "windows";
    seed({ capability: "notify-scoop" });
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle(/copy command/i));
    expect(writeText).toHaveBeenCalledWith("scoop update platypusgit");
  });

  it("keeps the command selectable by hand as well", () => {
    render(<UpdatePanel />);
    // `pg-selectable` is the escape hatch from the app-wide `user-select: none`.
    expect(screen.getByTestId("pg-update-pkg-hint")).toHaveClass(
      "pg-selectable",
    );
  });

  it("offers no copy button when there is no command to copy", () => {
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.queryByTitle(/copy command/i)).toBeNull();
  });

  it("says so instead of failing silently when the clipboard write rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTitle(/copy command/i));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-pg-flash]")?.textContent).toMatch(
        /could not copy/i,
      ),
    );
  });
});
