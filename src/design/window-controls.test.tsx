import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));

import { PGWindowControls } from "./window-controls";

describe("PGWindowControls", () => {
  it("wires each button to the correct window method", async () => {
    const user = userEvent.setup();
    render(<PGWindowControls />);

    await user.click(screen.getByRole("button", { name: /minimize/i }));
    expect(minimize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /maximize/i }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
