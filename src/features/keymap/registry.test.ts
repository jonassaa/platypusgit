import { describe, it, expect } from "vitest";
import { ACTIONS, ALL_ACTION_IDS } from "./registry";

describe("registry", () => {
  it("every action def id matches its key", () => {
    for (const [k, d] of Object.entries(ACTIONS)) expect(d.id).toBe(k);
  });
  it("nav actions cover all 9 activity screens + settings", () => {
    const navs = ALL_ACTION_IDS.filter((id) => id.startsWith("nav."));
    expect(navs.length).toBe(10);
  });
  it("pane-scoped actions exist", () => {
    expect(ACTIONS["pane.focusLeft"].scope).toBe("pane");
  });
  it("escape is allowed inside inputs", () => {
    expect(ACTIONS["app.closeOverlay"].allowInInput).toBe(true);
    expect(ACTIONS["nav.files"].allowInInput).toBeFalsy();
  });
});
