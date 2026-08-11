// Test helpers for the styled confirm/prompt dialogs (#61 C3).
//
// pgConfirm/pgPrompt resolve false/null when no <PGDialogHost/> is mounted, so
// a component test that renders one screen in isolation must render the host
// alongside it — otherwise every confirmation silently reads as "cancelled"
// and the assertion under test never gets a chance to run.

import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PGDialogHost, __resetDialogs } from "@/design";

/** Wrap a screen under test so pgConfirm/pgPrompt can actually render. */
export function WithDialogs({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PGDialogHost />
    </>
  );
}

/** Drop any dialog left queued by a previous case. */
export function resetDialogs() {
  __resetDialogs();
}

/** The open dialog's headline, or null when none is open. */
export function dialogTitle(): string | null {
  return screen.queryByTestId("dialog-title")?.textContent ?? null;
}

/** The open dialog's body text, or null. */
export function dialogBody(): string | null {
  const title = screen.queryByTestId("dialog-title");
  return title?.parentElement?.lastElementChild === title
    ? null
    : (title?.parentElement?.lastElementChild?.textContent ?? null);
}

export function dialogIsOpen(): boolean {
  return !!document.querySelector("[data-pg-dialog]");
}

/**
 * Accept the open dialog. `value` fills the input first — required for a
 * prompt, and for a confirm that demands a typed name.
 */
export async function acceptDialog(value?: string) {
  const input = screen.queryByTestId("dialog-input");
  if (value !== undefined && input) {
    fireEvent.change(input, { target: { value } });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId("dialog-confirm"));
  });
}

/** Dismiss the open dialog (same outcome as Escape or the backdrop). */
export async function dismissDialog() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("dialog-cancel"));
  });
}
