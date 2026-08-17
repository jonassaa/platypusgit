// The create-tag dialog replaced three single-value prompts (#132), and the
// value it added is the one with teeth: signing. These pin the three states of
// the sign toggle and the rule that ties them to the annotation — a lightweight
// tag has no object to sign, so the payload must never claim otherwise.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateTagDialog } from "./CreateTagDialog";
import { openCreateTag, useCreateTagStore } from "./useCreateTagStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const OID = "a".repeat(40);

const createCalls = () => getInvokeCalls().filter((c) => c.cmd === "create_tag");
const lastTarget = () =>
  createCalls()[createCalls().length - 1].args.target as {
    oid: string;
    annotation: string | null;
    sign: boolean | null;
  };

beforeEach(() => {
  resetInvokeMock();
  useCreateTagStore.setState({ target: null });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "main" },
  } as never);
  mockInvoke("create_tag", () => null);
  // createTag calls refreshAll on the way out.
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("get_log_page", () => ({ commits: [], hasMore: false }));
  mockInvoke("rebase_status", () => ({ inProgress: false, done: 0, total: 0 }));
});

async function openDialog() {
  render(<CreateTagDialog />);
  void openCreateTag({ oid: OID, shortOid: "aaaaaaa" });
  await waitFor(() => expect(screen.getByTestId("create-tag-name")).toBeTruthy());
}

describe("CreateTagDialog", () => {
  it("creates a lightweight tag when the annotation is blank", async () => {
    const user = userEvent.setup();
    await openDialog();

    await user.type(screen.getByTestId("create-tag-name"), "v1.0.0");
    await user.click(screen.getByTestId("create-tag-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args.name).toBe("v1.0.0");
    expect(lastTarget()).toMatchObject({
      oid: OID,
      annotation: null,
      // Explicitly unsigned, never null: tag.gpgsign must not be allowed to
      // promote a lightweight tag into something the user did not ask for.
      sign: false,
    });
  });

  it("leaves signing to git config until it is touched", async () => {
    const user = userEvent.setup();
    await openDialog();

    await user.type(screen.getByTestId("create-tag-name"), "v1.0.0");
    await user.type(screen.getByTestId("create-tag-annotation"), "release");
    await user.click(screen.getByTestId("create-tag-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    // null = follow tag.gpgsign, which the frontend cannot read. Sending false
    // would silently override a repository that has tag signing on.
    expect(lastTarget()).toMatchObject({ annotation: "release", sign: null });
  });

  it("sends an explicit true once the sign toggle is checked", async () => {
    const user = userEvent.setup();
    await openDialog();

    await user.type(screen.getByTestId("create-tag-name"), "v1.0.0");
    await user.type(screen.getByTestId("create-tag-annotation"), "release");
    await user.click(screen.getByTestId("create-tag-sign"));
    await user.click(screen.getByTestId("create-tag-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(lastTarget().sign).toBe(true);
  });

  it("disables signing while the annotation is blank", async () => {
    const user = userEvent.setup();
    await openDialog();

    const box = screen
      .getByTestId("create-tag-sign")
      .querySelector("input") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId("create-tag-sign").textContent).toContain(
      "needs an annotation",
    );

    await user.type(screen.getByTestId("create-tag-annotation"), "release");
    expect(box.disabled).toBe(false);
  });

  it("un-signs a tag whose annotation is blanked after checking sign", async () => {
    // The toggle keeps its state, but the payload must follow the tag's actual
    // shape — the backend refuses signed-lightweight, and the UI must never
    // send a combination it refuses.
    const user = userEvent.setup();
    await openDialog();

    await user.type(screen.getByTestId("create-tag-name"), "v1.0.0");
    await user.type(screen.getByTestId("create-tag-annotation"), "release");
    await user.click(screen.getByTestId("create-tag-sign"));
    await user.clear(screen.getByTestId("create-tag-annotation"));
    await user.click(screen.getByTestId("create-tag-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(lastTarget()).toMatchObject({ annotation: null, sign: false });
  });

  it("creates nothing when dismissed, and settles its promise", async () => {
    const user = userEvent.setup();
    render(<CreateTagDialog />);
    let settled = false;
    void openCreateTag({ oid: OID }).then(() => {
      settled = true;
    });
    await waitFor(() => expect(screen.getByTestId("create-tag-name")).toBeTruthy());

    await user.click(screen.getByText("Cancel"));

    await waitFor(() => expect(settled).toBe(true));
    expect(createCalls()).toHaveLength(0);
    expect(screen.queryByTestId("create-tag-name")).toBeNull();
  });

  it("does not carry a signing override into the next tag", async () => {
    // The per-commit override is not sticky either: it is an override, and
    // carrying it silently into the next one would surprise.
    const user = userEvent.setup();
    await openDialog();
    await user.type(screen.getByTestId("create-tag-name"), "v1.0.0");
    await user.type(screen.getByTestId("create-tag-annotation"), "release");
    await user.click(screen.getByTestId("create-tag-sign"));
    await user.click(screen.getByTestId("create-tag-submit"));
    await waitFor(() => expect(createCalls()).toHaveLength(1));

    void openCreateTag({ oid: OID });
    await waitFor(() => expect(screen.getByTestId("create-tag-name")).toBeTruthy());
    await user.type(screen.getByTestId("create-tag-name"), "v1.0.1");
    await user.type(screen.getByTestId("create-tag-annotation"), "next");
    await user.click(screen.getByTestId("create-tag-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(2));
    expect(lastTarget().sign).toBeNull();
  });
});
