// The saved-identity list, end to end (#233).
//
// The property worth guarding: applying an entry writes THIS REPOSITORY's
// config, never the global one. Getting that backwards would change every
// repository on the machine from a button labelled "Use here".

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { GitIdentity } from "@/lib/types";

import { SavedIdentities } from "./SavedIdentities";
import type { SavedIdentity } from "./identityList";

const WORK: SavedIdentity = {
  id: "a",
  label: "Work",
  name: "Ada Lovelace",
  email: "ada@corp.example",
};
const PERSONAL: SavedIdentity = {
  id: "b",
  label: "Personal",
  name: "Ada Lovelace",
  email: "ada@home.example",
};

/** What git currently resolves to. Moved by tests. */
let resolved: GitIdentity = {
  name: { value: "Ada Lovelace", scope: "global" },
  email: { value: "ada@home.example", scope: "global" },
  globalConfigPath: "/home/ada/.gitconfig",
  localConfigPath: "/repo/.git/config",
};

const saves = () => getInvokeCalls().filter((c) => c.cmd === "set_identity");

function renderList(repoId: string | null = "repo-1") {
  mockInvoke("get_identity", () => resolved);
  mockInvoke("set_identity", () => null);
  render(<SavedIdentities repoId={repoId} />);
  return waitFor(() => expect(screen.getByTestId("saved-identities")).toBeTruthy());
}

beforeEach(() => {
  resetInvokeMock();
  useSettingsStore.getState().reset();
  resolved = {
    name: { value: "Ada Lovelace", scope: "global" },
    email: { value: "ada@home.example", scope: "global" },
    globalConfigPath: "/home/ada/.gitconfig",
    localConfigPath: "/repo/.git/config",
  };
});

describe("applying an identity", () => {
  it("writes THIS repository's config, never the global one", async () => {
    // The whole feature, in one assertion. A mis-scoped write here changes
    // every repository on the machine.
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    await renderList();

    const applyButtons = screen.getAllByTestId("saved-identity-apply");
    fireEvent.click(applyButtons[0]!);

    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].args).toMatchObject({
      scope: "repository",
      repoId: "repo-1",
      name: "Ada Lovelace",
      email: "ada@corp.example",
    });
  });

  it("cannot be applied with no repository open", async () => {
    // The backend refuses repository scope without a repo id, so an enabled
    // button would be an offer that cannot be kept.
    useSettingsStore.getState().set("identities", [WORK]);
    await renderList(null);
    const btn = screen.getByTestId<HTMLButtonElement>("saved-identity-apply");
    expect(btn.disabled).toBe(true);
  });

  it("re-reads git afterwards rather than assuming the write landed", async () => {
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    await renderList();
    const before = getInvokeCalls().filter((c) => c.cmd === "get_identity").length;

    fireEvent.click(screen.getAllByTestId("saved-identity-apply")[0]!);
    await waitFor(() =>
      expect(
        getInvokeCalls().filter((c) => c.cmd === "get_identity").length,
      ).toBeGreaterThan(before),
    );
  });

  it("surfaces a refusal from the backend", async () => {
    useSettingsStore.getState().set("identities", [WORK]);
    mockInvoke("get_identity", () => resolved);
    mockInvoke("set_identity", () => {
      throw { kind: "InvalidArgument", message: "a name cannot contain '<'" };
    });
    render(<SavedIdentities repoId="repo-1" />);
    await waitFor(() => expect(screen.getByTestId("saved-identity-apply")).toBeTruthy());
    fireEvent.click(screen.getByTestId("saved-identity-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("saved-identity-error").textContent).toContain(
        "cannot contain",
      ),
    );
  });
});

describe("which one is in use", () => {
  it("marks the entry git actually resolves to", async () => {
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    await renderList();
    // `resolved` is the personal address.
    await waitFor(() =>
      expect(screen.getByTestId("saved-identity-active")).toBeTruthy(),
    );
    const rows = screen.getAllByTestId("saved-identity-row");
    expect(rows[1]?.textContent).toContain("in use here");
    expect(rows[0]?.textContent).not.toContain("in use here");
  });

  it("marks nothing when git resolves to an unsaved identity", async () => {
    resolved = {
      ...resolved,
      name: { value: "Grace Hopper", scope: "global" },
      email: { value: "grace@example.com", scope: "global" },
    };
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    await renderList();
    await waitFor(() => expect(screen.getAllByTestId("saved-identity-row")).toHaveLength(2));
    expect(screen.queryByTestId("saved-identity-active")).toBeNull();
  });

  it("does not offer to apply the one already in use", async () => {
    useSettingsStore.getState().set("identities", [PERSONAL]);
    await renderList();
    await waitFor(() => expect(screen.getByTestId("saved-identity-active")).toBeTruthy());
    expect(
      screen.getByTestId<HTMLButtonElement>("saved-identity-apply").disabled,
    ).toBe(true);
  });
});

describe("managing the list", () => {
  it("adds an identity", async () => {
    await renderList();
    fireEvent.click(screen.getByTestId("saved-identity-add"));
    fireEvent.change(screen.getByTestId("saved-identity-label-input"), {
      target: { value: "Work" },
    });
    fireEvent.change(screen.getByTestId("saved-identity-name-input"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByTestId("saved-identity-email-input"), {
      target: { value: "ada@corp.example" },
    });
    fireEvent.click(screen.getByTestId("saved-identity-save"));

    const stored = useSettingsStore.getState().identities;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      label: "Work",
      name: "Ada Lovelace",
      email: "ada@corp.example",
    });
  });

  it("will not save a half-filled row", async () => {
    await renderList();
    fireEvent.click(screen.getByTestId("saved-identity-add"));
    fireEvent.change(screen.getByTestId("saved-identity-label-input"), {
      target: { value: "Work" },
    });
    expect(
      screen.getByTestId<HTMLButtonElement>("saved-identity-save").disabled,
    ).toBe(true);
  });

  it("removes an identity without touching any repository", async () => {
    // Deleting a bookmark does not move the page: a repository already using
    // this identity keeps it, because the identity lives in git config.
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    await renderList();
    fireEvent.click(screen.getAllByTestId("saved-identity-remove")[0]!);
    expect(useSettingsStore.getState().identities.map((e) => e.id)).toEqual(["b"]);
    expect(saves()).toHaveLength(0);
  });

  it("edits an identity in place", async () => {
    useSettingsStore.getState().set("identities", [WORK]);
    await renderList();
    fireEvent.click(screen.getByTestId("saved-identity-edit"));
    fireEvent.change(screen.getByTestId("saved-identity-label-input"), {
      target: { value: "Day job" },
    });
    fireEvent.click(screen.getByTestId("saved-identity-save"));
    const stored = useSettingsStore.getState().identities;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.label).toBe("Day job");
    expect(stored[0]?.id).toBe("a");
  });
});

describe("privacy", () => {
  it("saved identities are not carried by a settings export", async () => {
    // An export is a file people SHARE. Every other preference describes how
    // the app behaves; this one is a list of someone's email addresses.
    useSettingsStore.getState().set("identities", [WORK, PERSONAL]);
    const json = useSettingsStore.getState().exportSettings();
    expect(json).not.toContain("ada@corp.example");
    expect(json).not.toContain("identities");
  });
});
