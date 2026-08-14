// Signature verification is a `git show` SUBPROCESS per call (#61 D6), so the
// badge must settle before asking — arrowing through the log otherwise spawns one
// process per row passed over, all still queued behind spawn_blocking after the
// user has stopped. The inline commit diff beside it in the same panel already
// debounces; this pins that the badge does too.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { SignatureBadge } from "./SignatureBadge";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const GOOD = { state: "Good", signer: "Ada <ada@x>", key: "ABCD" };

const verifyCalls = () => getInvokeCalls().filter((c) => c.cmd === "verify_commit");

beforeEach(() => {
  resetInvokeMock();
  vi.useRealTimers();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "main" },
  } as never);
  mockInvoke("verify_commit", () => GOOD);
});

describe("SignatureBadge", () => {
  it("verifies and renders the verdict", async () => {
    render(<SignatureBadge oid={"a".repeat(40)} />);

    await waitFor(() => expect(screen.getByTestId("signature-badge")).toBeTruthy());
    expect(screen.getByTestId("signature-badge").textContent).toContain("Signed");
    expect(verifyCalls()).toHaveLength(1);
  });

  it("does not verify a commit that was only passed through", async () => {
    // Three rows arrowed over in quick succession: only the one the user landed
    // on is worth a subprocess.
    const { rerender } = render(<SignatureBadge oid={"1".repeat(40)} />);
    rerender(<SignatureBadge oid={"2".repeat(40)} />);
    rerender(<SignatureBadge oid={"3".repeat(40)} />);

    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(verifyCalls()[0].args.oid).toBe("3".repeat(40));
  });

  it("renders nothing for an unsigned commit", async () => {
    mockInvoke("verify_commit", () => ({ state: "None", signer: null, key: null }));
    render(<SignatureBadge oid={"b".repeat(40)} />);

    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(screen.queryByTestId("signature-badge")).toBeNull();
  });
});
