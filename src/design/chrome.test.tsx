import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const platformMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform", () => ({
  usePlatform: platformMock,
  __esModule: true,
}));

import { PGTitlebar } from "./chrome";

beforeEach(() => {
  platformMock.mockReset();
});

describe("PGTitlebar", () => {
  it("renders the 80px shim on macOS and no window controls", () => {
    platformMock.mockReturnValue("macos");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("renders window controls on Windows and no shim", () => {
    platformMock.mockReturnValue("windows");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders window controls on Linux and no shim", () => {
    platformMock.mockReturnValue("linux");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
  });

  it("treats undefined platform as mac to avoid control-flash", () => {
    platformMock.mockReturnValue(undefined);
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("carries data-tauri-drag-region on root", () => {
    platformMock.mockReturnValue("macos");
    const { container } = render(<PGTitlebar repoName="demo" branch="main" />);
    const root = container.querySelector("[data-tauri-drag-region]");
    expect(root).not.toBeNull();
  });
});
