// Tag signature surfacing in the Branches screen (#132).
//
// The split is the point: `TagInfo.signed` is free (read off the object during
// the tag walk) so it can mark every row, and the graded verdict costs a
// `git verify-tag` subprocess so it is fetched for the SELECTED tag only. A
// verdict per row would be one process per row on every refresh, which is
// exactly what SignatureBadge refuses to do to the log.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import type { TagInfo } from "@/lib/types";

const tag = (name: string, signed: boolean): TagInfo => ({
  name,
  shortOid: "abc1234",
  oid: "abc1234def5678",
  signed,
});

const TAGS = [tag("v1.0.0", true), tag("v0.9.0", false)];

const verifyCalls = () => getInvokeCalls().filter((c) => c.cmd === "verify_tag");

beforeEach(() => {
  resetInvokeMock();
  resetDialogs();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [],
    branches: [],
    remotes: [],
    tags: TAGS,
    stashes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("verify_tag", () => ({
    state: "Good",
    signer: "Ada <ada@x>",
    key: "SHA256:abc",
  }));
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
});

describe("Branches: tag signatures", () => {
  it("marks a signed tag's row without verifying anything", () => {
    // Two tags listed, one glyph — and crucially, no subprocess for either.
    expect(screen.getAllByTestId("tag-signed-glyph")).toHaveLength(1);
    expect(verifyCalls()).toHaveLength(0);
  });

  it("verifies only the selected signed tag", async () => {
    fireEvent.click(screen.getByText("v1.0.0"));

    await waitFor(() =>
      expect(screen.getByTestId("tag-signature-badge")).toBeTruthy(),
    );
    expect(screen.getByTestId("tag-signature-badge").textContent).toContain(
      "Signed",
    );
    expect(verifyCalls()).toHaveLength(1);
    expect(verifyCalls()[0].args.name).toBe("v1.0.0");
  });

  it("does not verify an unsigned tag at all", async () => {
    fireEvent.click(screen.getByText("v0.9.0"));

    // `signed: false` came off the object, so there is nothing to ask git.
    await waitFor(() => expect(screen.getByText("Oid")).toBeTruthy());
    expect(screen.queryByTestId("tag-signature-badge")).toBeNull();
    expect(verifyCalls()).toHaveLength(0);
  });
});
