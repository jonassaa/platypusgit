// The shared image preview (#224).
//
// Four diff surfaces render this, so the rules it encodes are asserted once
// here rather than four times over four screens: what previews, what keeps the
// old empty state, and what says something more specific instead.

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { ImagePreview } from "@/lib/types";
import { ImageDiffOrEmpty, ImageDiffView, type ImageSide } from "./ImageDiffView";

const OLD: ImageSide = {
  key: "old",
  label: "Old",
  tone: "removed",
  source: { kind: "rev", revspec: "HEAD" },
};
const NEW: ImageSide = {
  key: "new",
  label: "New",
  tone: "added",
  source: { kind: "worktree" },
};

const png = (over: Partial<Extract<ImagePreview, { kind: "image" }>> = {}): ImagePreview => ({
  kind: "image",
  path: "logo.png",
  mediaType: "image/png",
  size: 1024,
  data: "AAAA",
  ...over,
});

/** Answer `read_image_preview` per source kind. */
function mockPreviews(by: Partial<Record<string, ImagePreview | null>>) {
  mockInvoke("read_image_preview", (args) => {
    const kind = (args.source as { kind: string }).kind;
    return by[kind] ?? null;
  });
}

/** Answer from the WHOLE request — the path and the revspec, not just the kind. */
function mockPreviewsBy(
  answer: (req: { path: string; revspec?: string }) => ImagePreview | null,
) {
  mockInvoke("read_image_preview", (args) =>
    answer({
      path: String(args.path),
      revspec: (args.source as { revspec?: string }).revspec,
    }),
  );
}

/** The `old` side stepped back one commit — a different blob at the same path. */
const OLD_PREV: ImageSide = {
  key: "old",
  label: "Old",
  tone: "removed",
  source: { kind: "rev", revspec: "HEAD~1" },
};

/** A `new`-keyed side reading one specific revision. */
const revSide = (revspec: string): ImageSide => ({
  key: "new",
  label: "New",
  tone: "added",
  source: { kind: "rev", revspec },
});

function renderPair(fallback?: React.ReactNode) {
  return render(
    <ImageDiffView repoId="r1" path="logo.png" sides={[OLD, NEW]} fallback={fallback} />,
  );
}

/**
 * The engine giving up on bytes whose STRUCTURE is sound.
 *
 * Not what a truncated blob fires — measured in Blink 152, a cut PNG fires
 * `load` and paints part of itself, which is why truncation is caught in the
 * backend instead (git/image.rs::integrity).
 */
function failDecode(testId: string) {
  fireEvent.error(screen.getByTestId(testId));
}

/** jsdom never decodes an image, so the dimensions arrive the way a real one's do. */
function decode(testId: string, w: number, h: number) {
  const img = screen.getByTestId(testId) as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  fireEvent.load(img);
}

describe("a `tooLarge` preview is NOTABLE, which suppresses the fallback", () => {
  // The interaction that made the #385 sentence unreachable, pinned here rather
  // than at the four surfaces — this is where the rule lives.
  //
  // `MAX_PREVIEW_BYTES` is 4 MiB and the diff ceiling is 5 MB, so EVERY blob
  // over the diff ceiling is also over the preview one and comes back
  // `tooLarge`. `isNotablePreview` counts that as notable, so this component
  // renders its panels and NOT the `fallback` — where the surfaces had put
  // "File too large to diff". The user read "Too large to preview" instead,
  // which says less and offers nothing to act on.
  //
  // It survived review because every other test here mocks previews to `null`,
  // and a null preview is not notable. So the fix is at the CALLERS (they check
  // `oversized` before reaching this component at all, see `OversizedDiffEmpty`)
  // and what this test pins is the fact that made the fix necessary — if it ever
  // stops being true, those precedence branches can go.
  it("renders the panels, not the fallback, when a side is too large", async () => {
    mockPreviews({
      rev: { kind: "tooLarge", path: "generated.sql", size: 6_700_000, limit: 4 * 1024 * 1024 },
      worktree: {
        kind: "tooLarge",
        path: "generated.sql",
        size: 6_700_000,
        limit: 4 * 1024 * 1024,
      },
    });
    render(
      <ImageDiffView
        repoId="r1"
        path="generated.sql"
        sides={[OLD, NEW]}
        fallback={<div>File too large to diff</div>}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("image-note-new")).toBeTruthy());
    expect(screen.getByTestId("image-note-new")).toHaveTextContent(/Too large to preview/);
    // The point: the caller's sentence never renders.
    expect(screen.queryByText("File too large to diff")).toBeNull();
  });
});

describe("an image diff", () => {
  it("renders both sides as local data: URLs", async () => {
    mockPreviews({
      rev: png({ size: 1024, data: "T0xE" }),
      worktree: png({ size: 4096, data: "TkVX" }),
    });
    renderPair();

    const oldImg = (await screen.findByTestId("image-preview-old")) as HTMLImageElement;
    const newImg = screen.getByTestId("image-preview-new") as HTMLImageElement;
    expect(oldImg.getAttribute("src")).toBe("data:image/png;base64,T0xE");
    expect(newImg.getAttribute("src")).toBe("data:image/png;base64,TkVX");
    // The promise the privacy guard exists to keep: bytes reach the <img>
    // without a request. Nothing here may ever become an http(s) URL.
    for (const img of [oldImg, newImg]) {
      expect(img.getAttribute("src")?.startsWith("data:")).toBe(true);
    }
  });

  it("captions each side with its byte size, and its pixels once decoded", async () => {
    mockPreviews({ rev: png({ size: 1024 }), worktree: png({ size: 4096 }) });
    renderPair();

    await screen.findByTestId("image-preview-old");
    // Before the image decodes there are no dimensions to report — and "0 × 0"
    // would be a lie, not a placeholder.
    expect(screen.getByTestId("image-caption-old").textContent).toBe("1.0 KB");

    decode("image-preview-old", 16, 16);
    decode("image-preview-new", 32, 32);
    expect(screen.getByTestId("image-caption-old").textContent).toBe("16 × 16 · 1.0 KB");
    expect(screen.getByTestId("image-caption-new").textContent).toBe("32 × 32 · 4.0 KB");
  });

  it("reports the delta of both currencies under the pair", async () => {
    mockPreviews({ rev: png({ size: 1024 }), worktree: png({ size: 4096 }) });
    renderPair();
    await screen.findByTestId("image-preview-old");
    decode("image-preview-old", 16, 16);
    decode("image-preview-new", 32, 32);

    expect(screen.getByTestId("image-diff-delta").textContent).toBe(
      "16 × 16 → 32 × 32 · 1.0 KB → 4.0 KB (+3.0 KB)",
    );
  });

  it("asks for each side by name, and asks only for the selected path", async () => {
    mockPreviews({ rev: png(), worktree: png() });
    renderPair();
    await screen.findByTestId("image-preview-old");

    const reads = getInvokeCalls().filter((c) => c.cmd === "read_image_preview");
    expect(reads.map((c) => c.args.source)).toEqual([
      { kind: "rev", revspec: "HEAD" },
      { kind: "worktree" },
    ]);
    expect(new Set(reads.map((c) => c.args.path))).toEqual(new Set(["logo.png"]));
  });

  it("never reads bytes for a file that has not been selected", () => {
    mockPreviews({ rev: png(), worktree: png() });
    render(<ImageDiffView repoId="r1" path={null} sides={[OLD, NEW]} />);
    expect(getInvokeCalls().filter((c) => c.cmd === "read_image_preview")).toEqual([]);
  });
});

describe("one side only", () => {
  it("shows the side that exists and names the add", async () => {
    // An added file has no old side — the backend answers null, which is a
    // state, not a failure.
    mockPreviews({ rev: null, worktree: png({ size: 2048 }) });
    renderPair();

    await screen.findByTestId("image-preview-new");
    expect(screen.queryByTestId("image-preview-old")).toBeNull();
    expect(screen.getByTestId("image-absent-old")).toBeInTheDocument();
    expect(screen.getByTestId("image-diff-onesided").textContent).toBe(
      "Added — no previous version",
    );
    // A delta needs two numbers; half a pair must not print one.
    expect(screen.queryByTestId("image-diff-delta")).toBeNull();
  });

  it("names the delete when the new side is the missing one", async () => {
    mockPreviews({ rev: png(), worktree: null });
    renderPair();
    await screen.findByTestId("image-preview-old");
    expect(screen.getByTestId("image-diff-onesided").textContent).toBe(
      "Removed — no new version",
    );
  });
});

describe("everything that is not a previewable image", () => {
  it("keeps the surface's existing empty state for another binary", async () => {
    // PDFs, fonts and archives are explicitly out of scope (#224): they must
    // reach the same sentence they reached before this feature existed.
    const unsupported: ImagePreview = {
      kind: "unsupported",
      path: "doc.pdf",
      size: 900,
      reason: "notAnImage",
    };
    mockPreviews({ rev: unsupported, worktree: unsupported });
    render(
      <ImageDiffOrEmpty
        repoId="r1"
        path="doc.pdf"
        sides={[OLD, NEW]}
        title="Binary file"
      >
        Binary diffs aren&apos;t shown.
      </ImageDiffOrEmpty>,
    );

    expect(await screen.findByText("Binary file")).toBeInTheDocument();
    expect(screen.getByText("Binary diffs aren't shown.")).toBeInTheDocument();
    expect(screen.queryByTestId("image-diff")).toBeNull();
  });

  it("says an image is too large rather than loading it", async () => {
    mockPreviews({
      rev: png({ size: 1024 }),
      worktree: {
        kind: "tooLarge",
        path: "huge.png",
        size: 9 * 1024 * 1024,
        limit: 4 * 1024 * 1024,
      },
    });
    renderPair();

    const note = await screen.findByTestId("image-note-new");
    expect(note.textContent).toBe(
      "Too large to preview — 9.0 MB (limit 4.0 MB)",
    );
    // The other side still previews: one oversized version does not blind the
    // whole comparison.
    expect(screen.getByTestId("image-preview-old")).toBeInTheDocument();
  });

  it("says an LFS object has not been fetched instead of rendering the pointer", async () => {
    mockPreviews({
      rev: null,
      worktree: {
        kind: "lfsMissing",
        path: "art.png",
        oid: "1a2b3c",
        size: 5 * 1024 * 1024,
      },
    });
    renderPair();

    const note = await screen.findByTestId("image-note-new");
    expect(note.textContent).toContain("LFS object not fetched");
    // The size comes from the pointer, so the panel can say how big the thing
    // it cannot show is.
    expect(note.textContent).toContain("5.0 MB");
  });

  it("says SVG previews are off, because refusing them is a decision", async () => {
    const svg: ImagePreview = {
      kind: "unsupported",
      path: "icon.svg",
      size: 400,
      reason: "svg",
    };
    mockPreviews({ rev: svg, worktree: svg });
    render(
      <ImageDiffOrEmpty repoId="r1" path="icon.svg" sides={[OLD, NEW]} title="Binary file">
        Binary diffs aren&apos;t shown.
      </ImageDiffOrEmpty>,
    );

    const note = await screen.findByTestId("image-note-new");
    expect(note.textContent).toContain("SVG previews are disabled");
    // ...and it must NOT fall through to the generic empty state, which would
    // look like the feature simply failed.
    expect(screen.queryByText("Binary diffs aren't shown.")).toBeNull();
  });

  it("names a truncated file, and never hands its bytes to an <img>", async () => {
    // The backend proved this from the file's own structure. It has to: a
    // webview decodes the prefix, fires `load`, reports the header's
    // dimensions and paints part of the picture, so no frontend signal
    // exists to catch it (measured — see git/image.rs::integrity).
    const cut: ImagePreview = {
      kind: "unsupported",
      path: "logo.png",
      size: 5448,
      reason: "truncated",
    };
    mockPreviews({ rev: cut, worktree: cut });
    render(
      <ImageDiffOrEmpty repoId="r1" path="logo.png" sides={[OLD, NEW]} title="Binary file">
        Binary diffs aren&apos;t shown.
      </ImageDiffOrEmpty>,
    );

    const note = await screen.findByTestId("image-note-new");
    expect(note.textContent).toContain("Truncated image");
    // The byte count is worth showing: it is what DID arrive.
    expect(note.textContent).toContain("5.3 KB");
    // The whole point — a partial picture under a confident caption is the
    // outcome this state exists to prevent.
    expect(screen.queryByTestId("image-preview-new")).toBeNull();
    expect(screen.queryByText("Binary diffs aren't shown.")).toBeNull();
  });

  it("falls back to the empty state when the read fails outright", async () => {
    mockInvoke("read_image_preview", () => {
      throw { kind: "Git", message: "object not found" };
    });
    render(
      <ImageDiffOrEmpty repoId="r1" path="logo.png" sides={[OLD, NEW]} title="Binary file">
        Binary diffs aren&apos;t shown.
      </ImageDiffOrEmpty>,
    );
    // A rejection must not take the pane down with it.
    expect(await screen.findByText("Binary file")).toBeInTheDocument();
  });
});

describe("a single side", () => {
  it("renders one panel with no add/delete caption", async () => {
    // Browsing a committed tree is not an "add" — there is one version because
    // one version was asked for.
    mockPreviews({ rev: png({ size: 2048 }) });
    render(
      <ImageDiffView
        repoId="r1"
        path="logo.png"
        sides={[{ key: "file", label: "File", tone: "neutral", source: { kind: "rev", revspec: "v1.0" } }]}
      />,
    );

    await screen.findByTestId("image-preview-file");
    expect(screen.queryByTestId("image-diff-onesided")).toBeNull();
    expect(screen.queryByTestId("image-diff-delta")).toBeNull();
  });
});

describe("a complete image this engine will not display", () => {
  // NOT the truncated case — that is refused in the backend, because a webview
  // reports a cut-off image as a successful `load` (see the `truncated` test
  // above and git/image.rs::integrity). What reaches `onError` is a file whose
  // structure is sound and whose format this particular engine lacks: an
  // exotic BMP or ICO variant, an animated WebP feature. Before #212's audit
  // item that rendered the broken-image glyph and said nothing.
  it("replaces the undisplayable image with a sentence, and keeps the size", async () => {
    mockPreviews({ worktree: png({ size: 1024 }) });
    render(<ImageDiffView repoId="r1" path="logo.png" sides={[NEW]} />);

    await screen.findByTestId("image-preview-new");
    failDecode("image-preview-new");

    await waitFor(() => expect(screen.queryByTestId("image-preview-new")).toBeNull());
    const note = screen.getByTestId("image-note-new").textContent;
    expect(note).toContain("could not be displayed");
    // It must NOT guess at a cause. Three engines ship this app and their
    // format coverage differs, so "truncated or corrupt" would be a lie on the
    // machines where the same file opens fine.
    expect(note).not.toMatch(/corrupt|truncated/i);
    // The byte count came from the backend, not from the decoder, so it is
    // still true and still worth showing.
    expect(screen.getByTestId("image-caption-new").textContent).toBe("1.0 KB");
  });

  it("fails only the side that failed", async () => {
    mockPreviews({ rev: png({ size: 2048 }), worktree: png({ size: 1024 }) });
    renderPair();

    await screen.findByTestId("image-preview-old");
    failDecode("image-preview-new");

    await waitFor(() => expect(screen.queryByTestId("image-preview-new")).toBeNull());
    // A corrupt new version must not take the readable old one down with it.
    // Seeing what the file used to be is most of the value of the comparison.
    expect(screen.getByTestId("image-preview-old")).toBeTruthy();
    expect(screen.queryByTestId("image-note-old")).toBeNull();
  });

  it("gives the next selection a clean slate", async () => {
    // The recovering file must be DIFFERENT bytes. Reusing the same base64
    // would assert the opposite of the truth: identical bytes really do fail
    // identically, and only jsdom's refusal to decode anything would hide it.
    mockPreviewsBy(({ path }) =>
      png({ path, data: path === "broken.png" ? "QkFE" : "R09PRA" }),
    );
    const one: ImageSide[] = [NEW];
    const { rerender } = render(<ImageDiffView repoId="r1" path="broken.png" sides={one} />);
    await screen.findByTestId("image-preview-new");
    failDecode("image-preview-new");
    await waitFor(() => expect(screen.getByTestId("image-note-new")).toBeTruthy());

    rerender(<ImageDiffView repoId="r1" path="fine.png" sides={one} />);
    // A sticky failure would print "could not be displayed" over a perfectly
    // good image, which is the same class of bug as a stale caption.
    await waitFor(() => expect(screen.getByTestId("image-preview-new")).toBeTruthy());
    expect(screen.queryByTestId("image-note-new")).toBeNull();
  });

  // The half the reset effect never had a test for. Its key was
  // `[path, previewKey]`, and `previewKey` could be DELETED outright without
  // failing anything in the suite; worse, it read `repoId` and each side's
  // `source` not at all, while `useImagePreviews` keys its read on both. So
  // this is the reachable stale case: one path, a different REVISION, and two
  // blobs of equal byte length — what a metadata-only edit produces, and what
  // `data.length` cannot tell apart.
  it("drops a failure when the revision changes under one path", async () => {
    mockPreviewsBy(({ revspec }) =>
      png({ data: revspec === "HEAD~1" ? "QkFE" : "R09P" }),
    );
    const { rerender } = render(
      <ImageDiffView repoId="r1" path="logo.png" sides={[revSide("HEAD~1")]} />,
    );
    await screen.findByTestId("image-preview-new");
    failDecode("image-preview-new");
    await waitFor(() => expect(screen.getByTestId("image-note-new")).toBeTruthy());

    rerender(<ImageDiffView repoId="r1" path="logo.png" sides={[revSide("HEAD")]} />);
    // Same path, same byte length, a different image. A stale failure would
    // print "could not be displayed" over a file that displays fine.
    await waitFor(() => expect(screen.getByTestId("image-preview-new")).toBeTruthy());
    expect(screen.queryByTestId("image-note-new")).toBeNull();
  });

  it("does not let one side's new bytes clear the other side's failure", async () => {
    mockPreviewsBy(({ revspec }) =>
      png({ data: revspec === "HEAD" ? "T0xE" : revspec ? "T0xEMg" : "TkVX" }),
    );
    const { rerender } = render(
      <ImageDiffView repoId="r1" path="logo.png" sides={[OLD, NEW]} />,
    );
    await screen.findByTestId("image-preview-new");
    failDecode("image-preview-new");
    await waitFor(() => expect(screen.getByTestId("image-note-new")).toBeTruthy());

    // The OLD side's blob changes — the user steps to the previous commit, or
    // an "LFS fetch" lands. One reset key covering BOTH sides cleared the new
    // side's live failure here, remounting an `<img>` whose decode cannot
    // succeed: the sentence blinked out and back, twice per change.
    rerender(<ImageDiffView repoId="r1" path="logo.png" sides={[OLD_PREV, NEW]} />);
    await waitFor(() =>
      expect(screen.getByTestId("image-preview-old").getAttribute("src")).toContain("T0xEMg"),
    );
    expect(screen.getByTestId("image-note-new")).toBeTruthy();
    expect(screen.queryByTestId("image-preview-new")).toBeNull();
  });
});

describe("re-selection", () => {
  it("re-reads when the path changes and drops the previous dimensions", async () => {
    // Two genuinely different files. Answering both paths with the SAME base64
    // would assert nothing: identical bytes are the same image, and 64 × 64
    // stays true for them — which is why this now has to differ to be a test.
    mockPreviewsBy(({ path }) =>
      png({ path, size: 1024, data: path === "a.png" ? "QUFB" : "QkJC" }),
    );
    const one: ImageSide[] = [NEW];
    const { rerender } = render(
      <ImageDiffView repoId="r1" path="a.png" sides={one} />,
    );
    await screen.findByTestId("image-preview-new");
    decode("image-preview-new", 64, 64);
    expect(screen.getByTestId("image-caption-new").textContent).toBe("64 × 64 · 1.0 KB");

    rerender(<ImageDiffView repoId="r1" path="b.png" sides={one} />);
    // A stale caption would report the previous file's pixels next to the new
    // file's bytes.
    await waitFor(() =>
      expect(screen.getByTestId("image-caption-new").textContent).toBe("1.0 KB"),
    );
    expect(
      getInvokeCalls().filter((c) => c.cmd === "read_image_preview").map((c) => c.args.path),
    ).toEqual(["a.png", "b.png"]);
  });
});
