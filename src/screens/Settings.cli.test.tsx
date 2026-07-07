import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { SettingsScreen } from "./Settings";

function mockShim(installed: boolean) {
  mockInvoke("cli_shim_status", () => ({
    installed,
    shimPath: "/usr/local/bin/pgit",
    target: "/Applications/PlatypusGit.app/Contents/MacOS/platypusgit",
  }));
}

describe("Settings command line section", () => {
  it("shows not-installed status and installs on click", async () => {
    mockShim(false);
    mockInvoke("install_cli_shim", () => ({
      installed: true,
      path: "/usr/local/bin/pgit",
      manualCommand: null,
    }));
    render(<SettingsScreen />);
    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    // Status refresh after install reports installed.
    mockShim(true);
    await userEvent.click(
      screen.getByRole("button", { name: /install pgit/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/\/usr\/local\/bin\/pgit/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/not installed/i)).not.toBeInTheDocument();
  });

  it("shows the manual command when install lacks permissions", async () => {
    mockShim(false);
    mockInvoke("install_cli_shim", () => ({
      installed: false,
      path: "/usr/local/bin/pgit",
      manualCommand: 'sudo ln -sf "/app/platypusgit" "/usr/local/bin/pgit"',
    }));
    render(<SettingsScreen />);
    await userEvent.click(
      await screen.findByRole("button", { name: /install pgit/i }),
    );
    expect(
      await screen.findByText(/sudo ln -sf/),
    ).toBeInTheDocument();
  });
});
