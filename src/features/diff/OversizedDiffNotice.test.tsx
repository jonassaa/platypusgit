// "Yes, really, show me" — the shared action and the shared truncation notice
// (#396).
//
// #385's notice named a limit and offered nothing to do about it. This is the
// half that acts on it, and the behaviours below are the ones that decide
// whether it is an escape hatch or a new dead end:
//
//   * offered only where reading anyway could actually produce text (an
//     over-ceiling blob), never for a real PNG;
//   * not offered twice for a blob over even the RAISED ceiling, because the
//     answer would not change;
//   * and the truncation it can produce says so, in numbers off the wire.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OversizedDiffAction, TruncatedDiffNotice } from "./OversizedDiffNotice";
import { diffAnywayExhausted, truncatedDiffNotice } from "@/lib/derive";
import type { FileDiff } from "@/lib/types";

const base: FileDiff = {
  path: "bundle.min.js",
  oldPath: null,
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
  oversized: null,
  truncated: null,
};

const oversized: FileDiff = {
  ...base,
  oversized: { size: 42_000_000, limit: 5 * 1024 * 1024, raised: false },
};

/** A real image: honestly binary, and no ceiling involved. */
const realBinary: FileDiff = { ...base, path: "logo.png" };

describe("OversizedDiffAction", () => {
  it("offers the escape hatch for a blob the ceiling refused", async () => {
    const onDiffAnyway = vi.fn();
    render(<OversizedDiffAction diff={oversized} onDiffAnyway={onDiffAnyway} />);

    const button = screen.getByTestId("diff-anyway");
    expect(button).toHaveTextContent("Diff it anyway");
    await userEvent.click(button);
    expect(onDiffAnyway).toHaveBeenCalledTimes(1);
  });

  it("offers nothing for a real binary", () => {
    // Reading a PNG anyway would still not produce a text diff, so the button
    // would promise something it cannot deliver. The plain "Binary file" empty
    // state is the right and complete answer there.
    render(<OversizedDiffAction diff={realBinary} onDiffAnyway={vi.fn()} />);
    expect(screen.queryByTestId("diff-anyway")).toBeNull();
  });

  it("offers nothing when there is no diff at all", () => {
    render(<OversizedDiffAction diff={null} onDiffAnyway={vi.fn()} />);
    expect(screen.queryByTestId("diff-anyway")).toBeNull();
  });

  it("says it is working, and refuses a second click while it is", async () => {
    // Re-reading 40 MB is seconds of work. A button that looks ignored is how
    // the user ends up firing three of them.
    const onDiffAnyway = vi.fn();
    render(
      <OversizedDiffAction diff={oversized} pending onDiffAnyway={onDiffAnyway} />,
    );

    const button = screen.getByTestId("diff-anyway");
    expect(button).toHaveTextContent("Reading…");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onDiffAnyway).not.toHaveBeenCalled();
  });

  it("stops offering itself once the raised ceiling refused too", () => {
    // The override raises the ceiling; it does not remove it. Offering the same
    // button again would promise an answer that cannot change — worse than no
    // button, because the user cannot tell it apart from a broken one.
    render(
      <OversizedDiffAction diff={oversized} alreadyTried onDiffAnyway={vi.fn()} />,
    );
    expect(screen.queryByTestId("diff-anyway")).toBeNull();
    expect(screen.getByTestId("diff-anyway-exhausted")).toHaveTextContent(
      /largest size the app will diff/i,
    );
  });
});

describe("diffAnywayExhausted", () => {
  it("is false for a blob refused by the DEFAULT ceiling", () => {
    // The ordinary refusal: the user has not asked for anything yet, so the
    // button belongs on screen.
    expect(diffAnywayExhausted(oversized)).toBe(false);
  });

  it("is true only when the RAISED ceiling was the one that refused", () => {
    const stillTooBig: FileDiff = {
      ...oversized,
      oversized: { size: 400_000_000, limit: 64 * 1024 * 1024, raised: true },
    };
    expect(diffAnywayExhausted(stillTooBig)).toBe(true);
  });

  it("reads the delta, not a list of paths the user clicked", () => {
    // The bug this shape replaced: keying off "did the user waive this path"
    // hid the button for the rest of the session, because a FRESH fetch never
    // passes the waiver — so the path stays in the list while the refusal is
    // the default ceiling's, and the action belongs back on screen.
    const refetchedAfterAWaiver: FileDiff = {
      ...oversized,
      oversized: { size: 42_000_000, limit: 5 * 1024 * 1024, raised: false },
    };
    expect(diffAnywayExhausted(refetchedAfterAWaiver)).toBe(false);
  });

  it("is false for anything that is not over a ceiling at all", () => {
    expect(diffAnywayExhausted(realBinary)).toBe(false);
    expect(diffAnywayExhausted(null)).toBe(false);
  });
});

describe("TruncatedDiffNotice / truncatedDiffNotice", () => {
  it("says nothing about a diff that arrived whole", () => {
    expect(truncatedDiffNotice(null)).toBeNull();
    expect(truncatedDiffNotice(oversized)).toBeNull();
    render(<TruncatedDiffNotice diff={oversized} />);
    expect(screen.queryByTestId("truncated-diff-notice")).toBeNull();
  });

  it("reports both numbers, from the wire", () => {
    const cut: FileDiff = {
      ...base,
      binary: false,
      oversized: null,
      truncated: { shown: 100_000, total: 812_345 },
    };
    render(<TruncatedDiffNotice diff={cut} />);

    const notice = screen.getByTestId("truncated-diff-notice");
    // Grouped for reading — six digits of diff is exactly the number a reader
    // needs to take in at a glance to understand why the pane stops.
    expect(notice).toHaveTextContent("100,000");
    expect(notice).toHaveTextContent("812,345");
    expect(notice).toHaveTextContent(/Diff shortened/);
  });
});
