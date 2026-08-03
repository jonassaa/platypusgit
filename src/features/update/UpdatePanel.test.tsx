import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useUpdateStore } from "./useUpdateStore";
import { UpdatePanel } from "./UpdatePanel";
import { UpdateChip } from "./UpdateChip";
import type { Platform } from "@/lib/platform";
import type { UpdateInfo } from "@/lib/types";

// Mutable so BOTH platform arms are reachable. A module-level `() => "macos"`
// made the Linux/.deb notify case (no brew hint) impossible to express.
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
    expect(screen.getByTestId("pg-update-brew-hint")).toHaveTextContent(
      "brew upgrade platypusgit",
    );
  });

  it("notify on Linux (.deb install) offers 'View release' with NO brew hint", () => {
    platformMock.value = "linux";
    seed({ capability: "notify" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.queryByTestId("pg-update-brew-hint")).toBeNull();
  });

  it("self-update offers 'Install' and never the brew hint", () => {
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/install/i);
    expect(screen.queryByTestId("pg-update-brew-hint")).toBeNull();
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
