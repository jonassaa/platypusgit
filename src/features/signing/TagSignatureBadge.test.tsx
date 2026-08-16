// Tag verification is a `git verify-tag` SUBPROCESS per call (#132), so the
// badge debounces exactly as the commit one does — and it renders for the
// SELECTED tag only, which is what keeps the Branches screen from spawning one
// process per tag row on every refresh.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { TagSignatureBadge } from "./TagSignatureBadge";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const GOOD = { state: "Good", signer: "Ada <ada@x>", key: "SHA256:abc" };

const verifyCalls = () => getInvokeCalls().filter((c) => c.cmd === "verify_tag");

beforeEach(() => {
  resetInvokeMock();
  vi.useRealTimers();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "main" },
  } as never);
  mockInvoke("verify_tag", () => GOOD);
});

describe("TagSignatureBadge", () => {
  it("verifies the tag and renders the verdict", async () => {
    render(<TagSignatureBadge name="v1.0.0" />);

    await waitFor(() => expect(screen.getByTestId("tag-signature-badge")).toBeTruthy());
    const badge = screen.getByTestId("tag-signature-badge");
    expect(badge.textContent).toContain("Signed");
    expect(badge.getAttribute("title")).toContain("Ada <ada@x>");
    expect(verifyCalls()).toHaveLength(1);
    expect(verifyCalls()[0].args.name).toBe("v1.0.0");
  });

  it("does not verify a tag that was only passed through", async () => {
    const { rerender } = render(<TagSignatureBadge name="v1" />);
    rerender(<TagSignatureBadge name="v2" />);
    rerender(<TagSignatureBadge name="v3" />);

    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(verifyCalls()[0].args.name).toBe("v3");
  });

  it("renders nothing for an unsigned tag", async () => {
    mockInvoke("verify_tag", () => ({ state: "None", signer: null, key: null }));
    render(<TagSignatureBadge name="v1.0.0" />);

    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(screen.queryByTestId("tag-signature-badge")).toBeNull();
  });

  it("shows a bad signature rather than staying silent", async () => {
    mockInvoke("verify_tag", () => ({ state: "Bad", signer: null, key: null }));
    render(<TagSignatureBadge name="v1.0.0" />);

    await waitFor(() => expect(screen.getByTestId("tag-signature-badge")).toBeTruthy());
    expect(screen.getByTestId("tag-signature-badge").textContent).toContain(
      "Bad signature",
    );
  });

  it("keeps quiet when verification itself fails", async () => {
    // Not worth an error banner: the tag and everything around it are still
    // perfectly usable.
    mockInvoke("verify_tag", () => {
      throw { kind: "Git", message: "boom" };
    });
    render(<TagSignatureBadge name="v1.0.0" />);

    await waitFor(() => expect(verifyCalls()).toHaveLength(1));
    expect(screen.queryByTestId("tag-signature-badge")).toBeNull();
  });
});
