import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useUpdateStore } from "./useUpdateStore";
import { UpdatePanel } from "./UpdatePanel";
import { UpdateChip } from "./UpdateChip";
import type { UpdateInfo } from "@/lib/types";

vi.mock("@/lib/platform", () => ({
  usePlatform: () => "macos",
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
    progress: null,
    error: null,
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

describe("UpdatePanel", () => {
  beforeEach(() => seed({}));

  it("labels the action 'View release' for notify capability and shows brew hint on macOS", () => {
    seed({ capability: "notify" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(
      /view release/i,
    );
    expect(screen.getByTestId("pg-update-brew-hint")).toHaveTextContent(
      "brew upgrade platypusgit",
    );
  });

  it("labels the action 'Install' for self-update capability", () => {
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/install/i);
    expect(screen.queryByTestId("pg-update-brew-hint")).toBeNull();
  });

  it("dismiss closes the panel", async () => {
    seed({});
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTestId("pg-update-dismiss"));
    expect(useUpdateStore.getState().panelOpen).toBe(false);
  });
});
