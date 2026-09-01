// The saved-identity list model (#233).
//
// The load-bearing function here is `activeIdentity`. It answers "which of my
// saved identities is this repository actually using" by comparing against what
// git resolved — never against a remembered assignment — which is what keeps
// the app from confidently naming an identity the next commit will not use.

import { describe, expect, it } from "vitest";

import {
  activeIdentity,
  isSavableIdentity,
  newIdentityId,
  normalizeIdentity,
  removeIdentity,
  upsertIdentity,
  type SavedIdentity,
} from "./identityList";

const work: SavedIdentity = {
  id: "a",
  label: "Work",
  name: "Ada Lovelace",
  email: "ada@corp.example",
};
const personal: SavedIdentity = {
  id: "b",
  label: "Personal",
  name: "Ada Lovelace",
  email: "ada@home.example",
};

describe("activeIdentity", () => {
  it("matches on the name and email pair, not the label", () => {
    // The label is ours; the pair is git's. A repository configured by hand or
    // by another tool must still light up the entry it corresponds to.
    expect(
      activeIdentity([work, personal], {
        name: "Ada Lovelace",
        email: "ada@home.example",
      })?.id,
    ).toBe("b");
  });

  it("distinguishes two identities that share a name", () => {
    // The overwhelmingly common shape of this feature: same person, two
    // addresses. Matching on name alone would pick whichever came first.
    expect(
      activeIdentity([work, personal], {
        name: "Ada Lovelace",
        email: "ada@corp.example",
      })?.id,
    ).toBe("a");
  });

  it("is case-insensitive about the email", () => {
    // Addresses are. `Ada@Corp.Example` and `ada@corp.example` are the same
    // person, not an unmatched identity.
    expect(
      activeIdentity([work], { name: "Ada Lovelace", email: "Ada@Corp.Example" })
        ?.id,
    ).toBe("a");
  });

  it("tolerates surrounding whitespace on either side", () => {
    expect(
      activeIdentity([work], {
        name: "  Ada Lovelace ",
        email: " ada@corp.example  ",
      })?.id,
    ).toBe("a");
  });

  it("is null when git resolves to something not on the list", () => {
    // The honest answer, and the common one: most repositories use the global
    // identity, which may not be saved here at all.
    expect(
      activeIdentity([work, personal], {
        name: "Grace Hopper",
        email: "grace@example.com",
      }),
    ).toBeNull();
  });

  it("is null when git has no identity at all", () => {
    expect(activeIdentity([work], { name: null, email: null })).toBeNull();
    expect(activeIdentity([work], { name: "Ada Lovelace", email: "" })).toBeNull();
    expect(activeIdentity([work], { name: undefined, email: undefined })).toBeNull();
  });

  it("does not match a blank identity against a blank saved entry", () => {
    // A present-but-blank `user.email` is the state git refuses on. It must not
    // quietly "match" anything.
    const empty: SavedIdentity = { id: "c", label: "x", name: "", email: "" };
    expect(activeIdentity([empty], { name: "  ", email: "  " })).toBeNull();
  });
});

describe("editing the list", () => {
  it("adds a new entry at the end", () => {
    expect(upsertIdentity([work], personal).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("replaces by id, in place", () => {
    const renamed = { ...work, label: "Day job" };
    const next = upsertIdentity([work, personal], renamed);
    expect(next.map((e) => e.id)).toEqual(["a", "b"]);
    expect(next[0]?.label).toBe("Day job");
  });

  it("trims what it stores", () => {
    const next = upsertIdentity([], {
      id: "x",
      label: "  Work  ",
      name: " Ada ",
      email: " ada@example.com ",
    });
    expect(next[0]).toEqual({
      id: "x",
      label: "Work",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("removes by id and leaves the rest alone", () => {
    expect(removeIdentity([work, personal], "a").map((e) => e.id)).toEqual(["b"]);
    expect(removeIdentity([work], "nope").map((e) => e.id)).toEqual(["a"]);
  });

  it("never mutates the input", () => {
    const list = [work];
    upsertIdentity(list, personal);
    removeIdentity(list, "a");
    expect(list).toEqual([work]);
  });
});

describe("what is savable", () => {
  it("requires all three fields, non-blank", () => {
    expect(isSavableIdentity(work)).toBe(true);
    expect(isSavableIdentity({ ...work, label: "" })).toBe(false);
    expect(isSavableIdentity({ ...work, name: "   " })).toBe(false);
    expect(isSavableIdentity({ ...work, email: "" })).toBe(false);
  });

  it("does not re-implement what git will accept", () => {
    // Blankness only. `Ada <Lovelace>` is refused by the BACKEND, whose message
    // names the offending character — duplicating that rule here would create a
    // second place for it to drift.
    expect(isSavableIdentity({ ...work, name: "Ada <Lovelace>" })).toBe(true);
  });

  it("normalizeIdentity is what upsert stores", () => {
    const messy = { id: "x", label: " a ", name: " b ", email: " c " };
    expect(normalizeIdentity(messy)).toEqual({
      id: "x",
      label: "a",
      name: "b",
      email: "c",
    });
  });
});

describe("ids", () => {
  it("are unique within a session", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newIdentityId()));
    expect(ids.size).toBe(50);
  });
});
