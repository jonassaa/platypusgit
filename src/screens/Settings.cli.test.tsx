import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import type { CliPathState, CliShimSource } from "@/lib/types";
import { CliPage } from "@/features/settings/pages/cli";

function mockShim(
  source: CliShimSource,
  opts: { shimPath?: string; pathState?: CliPathState } = {},
) {
  mockInvoke("cli_shim_status", () => ({
    installed: source === "app" || source === "package",
    shimPath: opts.shimPath ?? "/usr/local/bin/pgit",
    target: "/Applications/PlatypusGit.app/Contents/MacOS/platypusgit",
    source,
    pathState: opts.pathState ?? "onPath",
  }));
}

describe("Settings command line section", () => {
  it("shows not-installed status and installs on click", async () => {
    mockShim("none");
    mockInvoke("install_cli_shim", () => ({
      installed: true,
      path: "/usr/local/bin/pgit",
      manualCommand: null,
      pathState: "onPath",
    }));
    render(<CliPage />);
    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    // Status refresh after install reports installed.
    mockShim("app");
    await userEvent.click(
      screen.getByRole("button", { name: /install pgit/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("/usr/local/bin/pgit")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/not installed/i)).not.toBeInTheDocument();
  });

  it("shows the manual command when install lacks permissions", async () => {
    mockShim("none");
    mockInvoke("install_cli_shim", () => ({
      installed: false,
      path: "/usr/local/bin/pgit",
      manualCommand: 'sudo ln -sf "/app/platypusgit" "/usr/local/bin/pgit"',
      pathState: "onPath",
    }));
    render(<CliPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /install pgit/i }),
    );
    expect(await screen.findByText(/sudo ln -sf/)).toBeInTheDocument();
  });

  // ─── the ownership contract (#144) ─────────────────────────────────────────

  it("reports a package-managed pgit as installed and offers no button", async () => {
    // The whole point of #144's last note: dpkg / Homebrew / the MSI own the
    // file, so there must be nothing here that would overwrite it.
    mockShim("package", { shimPath: "/usr/bin/pgit" });
    render(<CliPage />);
    expect(
      await screen.findByText(/installed by your package manager/i),
    ).toBeInTheDocument();
    expect(screen.getByText("/usr/bin/pgit")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /install pgit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reinstall pgit/i }),
    ).not.toBeInTheDocument();
  });

  it("names a stranger's pgit without claiming it, and still offers an install", async () => {
    mockShim("foreign", { shimPath: "/opt/somewhere/pgit" });
    render(<CliPage />);
    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/is already on your PATH at/i),
    ).toBeInTheDocument();
    expect(screen.getByText("/opt/somewhere/pgit")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /install pgit/i }),
    ).toBeInTheDocument();
  });

  it("offers Reinstall for a shim we installed ourselves", async () => {
    mockShim("app", { shimPath: "/home/ada/.local/bin/pgit" });
    render(<CliPage />);
    expect(
      await screen.findByRole("button", { name: /reinstall pgit/i }),
    ).toBeInTheDocument();
  });

  it("names the directory to add when the shim is off PATH", async () => {
    // Installed but unusable is the macOS ~/.local/bin case — it must not read
    // as a plain success.
    mockShim("app", {
      shimPath: "/Users/ada/.local/bin/pgit",
      pathState: "offPath",
    });
    render(<CliPage />);
    expect(
      await screen.findByText(/is not on your PATH/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText('export PATH="/Users/ada/.local/bin:$PATH"'),
    ).toBeInTheDocument();
  });

  it("tells the user to open a new terminal after a PATH write", async () => {
    mockShim("none", { shimPath: "C:\\Users\\ada\\AppData\\Local\\PlatypusGit\\bin\\pgit" });
    mockInvoke("install_cli_shim", () => ({
      installed: true,
      path: "C:\\Users\\ada\\AppData\\Local\\PlatypusGit\\bin\\pgit.cmd",
      manualCommand: null,
      pathState: "pathAdded",
    }));
    render(<CliPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /install pgit/i }),
    );
    expect(await screen.findByText(/open a new terminal/i)).toBeInTheDocument();
  });

  it("never suggests a PATH edit for a package-managed shim", async () => {
    // The package put it on PATH; an offPath reading there would be our bug,
    // not something to hand the user a shell line about.
    mockShim("package", { shimPath: "/usr/bin/pgit", pathState: "offPath" });
    render(<CliPage />);
    expect(
      await screen.findByText(/installed by your package manager/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is not on your PATH/i)).not.toBeInTheDocument();
  });
});
