// The identity's SCOPE control (#233).
//
// #212 could only write the global config, which is the right fix for a fresh
// machine and the wrong one for the case this file is about: a work identity
// and a personal identity on the same machine. Getting that wrong puts a
// corporate address on a public commit, and no amount of later editing takes it
// back — so the tests here are mostly about the app never picking a config file
// on the user's behalf.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { pgPickOption } from "@/test/select";
import type { GitIdentity } from "@/lib/types";

import { IdentityForm } from "./IdentityForm";

const GLOBAL_PATH = "/home/ada/.gitconfig";
const LOCAL_PATH = "/repo/.git/config";

/** A repository is open: both scopes are real. */
const withRepo = (over?: Partial<GitIdentity>): GitIdentity => ({
  name: { value: "Ada Lovelace", scope: "global" },
  email: { value: "ada@example.com", scope: "global" },
  globalConfigPath: GLOBAL_PATH,
  localConfigPath: LOCAL_PATH,
  ...over,
});

/** Settings with nothing open: only global exists. */
const noRepo = (): GitIdentity => ({
  name: { value: "Ada Lovelace", scope: "global" },
  email: { value: "ada@example.com", scope: "global" },
  globalConfigPath: GLOBAL_PATH,
  localConfigPath: null,
});

const saves = () => getInvokeCalls().filter((c) => c.cmd === "set_identity");

/** PGSelect is an in-page listbox, not a native `<select>` — see @/test/select. */
const pickScope = (value: string) =>
  pgPickOption(screen.getByTestId("identity-scope"), value);

/**
 * Render and wait until the identity has actually LOADED — not merely until
 * the form has mounted.
 *
 * The form renders immediately and seeds its fields from an async
 * `get_identity`. Waiting only for `identity-form` therefore returns while
 * Name and Email are still empty, which leaves Save disabled — so a test that
 * clicks it straight away silently does nothing and asserts on zero calls.
 * That raced: it passed locally and failed on CI, which is the worst version
 * of the bug.
 *
 * `identity-target` is the right thing to wait on: it renders from the loaded
 * `identity`, so its presence means the seeding has happened.
 */
function renderForm(identity: GitIdentity, repoId: string | null = "repo-1") {
  mockInvoke("get_identity", () => identity);
  mockInvoke("set_identity", () => null);
  render(<IdentityForm repoId={repoId} />);
  return waitFor(() => {
    expect(screen.getByTestId("identity-form")).toBeTruthy();
    expect(screen.getByTestId("identity-target")).toBeTruthy();
  });
}

beforeEach(() => {
  resetInvokeMock();
});

describe("which scopes are offered", () => {
  it("offers both when a repository is open", async () => {
    await renderForm(withRepo());
    await waitFor(() => expect(screen.getByTestId("identity-scope")).toBeTruthy());
  });

  it("offers no choice at all with no repository open", async () => {
    // The backend refuses repository scope without a repo, so offering it here
    // would be an option that cannot work. Settings before a repo is opened is
    // exactly where a new user lands from Welcome.
    await renderForm(noRepo(), null);
    expect(screen.queryByTestId("identity-scope")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        GLOBAL_PATH,
      ),
    );
  });
});

describe("the scope it opens on", () => {
  it("defaults to global when the repository has no override", async () => {
    // The overwhelmingly common case, and #212's fresh-machine case too.
    await renderForm(withRepo());
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        GLOBAL_PATH,
      ),
    );
  });

  it("defaults to this repository when the repository already overrides", async () => {
    // Someone with a repo-local identity is managing that repository's
    // identity. Opening on "global" would invite them to edit the value that
    // is being overridden — a save that appears to do nothing.
    await renderForm(
      withRepo({
        name: { value: "Work Person", scope: "repository" },
        email: { value: "work@corp.example", scope: "repository" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        LOCAL_PATH,
      ),
    );
  });

  it("defaults to this repository when only ONE half is overridden", async () => {
    // A repo that sets only `user.email` is the common shape of exactly this
    // feature's use case — the name is the same at work and at home.
    await renderForm(
      withRepo({ email: { value: "work@corp.example", scope: "repository" } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        LOCAL_PATH,
      ),
    );
  });
});

describe("what a save sends", () => {
  it("sends the repository scope and the repo id", async () => {
    await renderForm(withRepo());
    pickScope("repository");
    fireEvent.change(screen.getByTestId("identity-name"), {
      target: { value: "Work Person" },
    });
    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "work@corp.example" },
    });
    fireEvent.click(screen.getByTestId("identity-save"));

    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].args).toMatchObject({
      scope: "repository",
      repoId: "repo-1",
      name: "Work Person",
      email: "work@corp.example",
    });
  });

  it("sends the global scope when that is what is selected", async () => {
    await renderForm(withRepo());
    fireEvent.click(screen.getByTestId("identity-save"));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].args).toMatchObject({ scope: "global" });
  });

  it("always sends a scope — never leaves the backend to guess", async () => {
    // The one property this whole feature rests on. A save with no scope would
    // be the backend's default, decided somewhere the user cannot see.
    await renderForm(noRepo(), null);
    fireEvent.click(screen.getByTestId("identity-save"));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].args.scope).toBe("global");
  });
});

describe("the target file named beside the button", () => {
  it("follows the scope, so the two can never disagree", async () => {
    await renderForm(withRepo());
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        GLOBAL_PATH,
      ),
    );
    pickScope("repository");
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        LOCAL_PATH,
      ),
    );
  });
});

describe("the override warning", () => {
  const overridden = () =>
    withRepo({
      name: { value: "Work Person", scope: "repository" },
      email: { value: "work@corp.example", scope: "repository" },
    });

  it("is silent at repository scope, where there is nothing to warn about", async () => {
    // Saving here writes exactly the value that wins. Warning anyway would
    // train people to ignore the warning that matters.
    await renderForm(overridden());
    await waitFor(() =>
      expect(screen.getByTestId("identity-target").textContent).toContain(
        LOCAL_PATH,
      ),
    );
    expect(screen.queryByTestId("identity-scope-note")).toBeNull();
  });

  it("appears on switching to global, and points at the other scope", async () => {
    await renderForm(overridden());
    pickScope("global");
    await waitFor(() =>
      expect(screen.getByTestId("identity-scope-note")).toBeTruthy(),
    );
    const note = screen.getByTestId("identity-scope-note").textContent ?? "";
    expect(note).toContain("This repository sets its own");
    expect(note).toContain("save to this repository instead");
    // No issue numbers in prose a user reads.
    expect(note).not.toMatch(/#\d+/);
  });
});
