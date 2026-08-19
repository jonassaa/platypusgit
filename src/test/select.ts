// Driving a PGSelect from a component test.
//
// PGSelect is an in-page listbox, not a native `<select>` (issue 146 — see the
// comment above the component), so `userEvent.selectOptions` and
// `fireEvent.change` no longer apply to it: there is no `<option>` and no
// `change` event. These helpers are the replacement, and they live here
// rather than in each test file because six suites drive one of these controls
// and a second copy of the open-then-click sequence would drift.
//
// The e2e counterpart is `jsPickOption` in `e2e/support/app.ts`; keep the two
// selecting on the SAME attributes (`[data-pg-select-trigger]`,
// `[data-pg-listbox]`, `[data-pg-option][data-value]`).

import { fireEvent } from "@testing-library/react";

const LISTBOX = "[data-pg-listbox]";

/** The trigger of the PGSelect inside `row` (a rebase plan row, a dialog
 *  field). Throws rather than returning null so a moved control fails where it
 *  is looked up. */
export function pgSelectTrigger(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[data-pg-select-trigger]");
  if (!el) throw new Error("pgSelectTrigger: no PGSelect trigger inside this element");
  return el;
}

function openList(trigger: HTMLElement): HTMLElement {
  if (!document.querySelector(LISTBOX)) {
    fireEvent.mouseDown(trigger, { button: 0 });
  }
  const list = document.querySelector<HTMLElement>(LISTBOX);
  if (!list) {
    throw new Error(
      "pgSelect: the listbox never opened — is this element a PGSelect trigger?",
    );
  }
  return list;
}

function optionEls(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>("[data-pg-option]")];
}

/** The values a PGSelect offers, in order. Opens the listbox to read them and
 *  closes it again, so it composes with a later pick. */
export function pgSelectValues(trigger: HTMLElement): string[] {
  const values = optionEls(openList(trigger)).map(
    (o) => o.getAttribute("data-value") ?? "",
  );
  fireEvent.keyDown(trigger, { key: "Escape" });
  return values;
}

/** Pick an option the way a user does: open, then click the row. */
export function pgPickOption(trigger: HTMLElement, value: string): void {
  const list = openList(trigger);
  const opts = optionEls(list);
  const opt = opts.find((o) => o.getAttribute("data-value") === value);
  if (!opt) {
    const have = opts.map((o) => o.getAttribute("data-value")).join(", ");
    throw new Error(`pgPickOption: no option "${value}" (offered: ${have})`);
  }
  fireEvent.click(opt);
}
