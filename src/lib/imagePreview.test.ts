// The pure rules behind the image preview panels (#224).

import { describe, expect, it } from "vitest";
import {
  describeByteDelta,
  describeDelta,
  describeSide,
  formatDims,
  hasImage,
  imageSourceFromSide,
  isNotablePreview,
  previewDataUrl,
} from "./imagePreview";
import type { ImagePreview } from "./types";

type ImageOk = Extract<ImagePreview, { kind: "image" }>;

const image = (over: Partial<ImageOk> = {}): ImageOk => ({
  kind: "image",
  path: "logo.png",
  mediaType: "image/png",
  size: 1024,
  data: "AAAA",
  ...over,
});

describe("previewDataUrl", () => {
  it("builds a data: URL from the media type the BYTES were sniffed as", () => {
    // Not the extension: `logo.png` holding a JPEG must be served as a JPEG.
    expect(previewDataUrl(image({ mediaType: "image/jpeg" }))).toBe(
      "data:image/jpeg;base64,AAAA",
    );
  });

  it("stays local — a preview never names a host", () => {
    // The privacy guard scans for hostnames; this pins the intent behind it.
    expect(previewDataUrl(image()).startsWith("data:")).toBe(true);
  });
});

describe("isNotablePreview", () => {
  it("shows a panel for an image, a too-large blob and a missing LFS object", () => {
    expect(isNotablePreview(image())).toBe(true);
    expect(
      isNotablePreview({ kind: "tooLarge", path: "a.png", size: 9e6, limit: 4e6 }),
    ).toBe(true);
    expect(
      isNotablePreview({ kind: "lfsMissing", path: "a.png", oid: "ab", size: 9e6 }),
    ).toBe(true);
  });

  it("keeps the old empty state for a binary that is not an image", () => {
    // PDFs, fonts and archives are explicitly out of scope for #224.
    expect(
      isNotablePreview({
        kind: "unsupported",
        path: "a.pdf",
        size: 10,
        reason: "notAnImage",
      }),
    ).toBe(false);
    expect(isNotablePreview(null)).toBe(false);
  });

  it("DOES speak up about an SVG, because refusing it is a decision", () => {
    expect(
      isNotablePreview({ kind: "unsupported", path: "i.svg", size: 10, reason: "svg" }),
    ).toBe(true);
  });
});

describe("hasImage", () => {
  it("is true when either side decoded", () => {
    expect(hasImage([null, image()])).toBe(true);
    expect(hasImage([null, null])).toBe(false);
  });
});

describe("captions", () => {
  it("omits dimensions until the image has actually decoded", () => {
    // naturalWidth is 0 before load; printing "0 × 0" would be a lie.
    expect(formatDims(null)).toBe(null);
    expect(formatDims({ w: 0, h: 0 })).toBe(null);
    expect(formatDims({ w: 512, h: 384 })).toBe("512 × 384");
    expect(describeSide(2048, null)).toBe("2.0 KB");
    expect(describeSide(2048, { w: 16, h: 16 })).toBe("16 × 16 · 2.0 KB");
  });
});

describe("describeByteDelta", () => {
  it("signs the change and uses a real minus", () => {
    expect(describeByteDelta(1024, 3072)).toBe("+2.0 KB");
    expect(describeByteDelta(3072, 1024)).toBe("−2.0 KB");
    expect(describeByteDelta(10, 10)).toBe("no size change");
  });
});

describe("describeDelta", () => {
  it("reports both currencies when both sides decoded", () => {
    expect(
      describeDelta(
        { size: 1024, dims: { w: 16, h: 16 } },
        { size: 4096, dims: { w: 32, h: 32 } },
      ),
    ).toBe("16 × 16 → 32 × 32 · 1.0 KB → 4.0 KB (+3.0 KB)");
  });

  it("does not repeat an unchanged dimension or size", () => {
    expect(
      describeDelta(
        { size: 4096, dims: { w: 32, h: 32 } },
        { size: 4096, dims: { w: 32, h: 32 } },
      ),
    ).toBe("32 × 32 · 4.0 KB");
  });

  it("is null for an added or deleted file", () => {
    // A delta needs two numbers. Half a pair is how "+100%" gets printed for a
    // file that never had a previous version.
    expect(describeDelta(null, { size: 10 })).toBe(null);
    expect(describeDelta({ size: 10 }, null)).toBe(null);
  });
});

describe("imageSourceFromSide", () => {
  it("reuses the side each surface already computed for syntax", () => {
    expect(imageSourceFromSide({ kind: "worktree" })).toEqual({ kind: "worktree" });
    expect(imageSourceFromSide({ kind: "index" })).toEqual({ kind: "index" });
    expect(imageSourceFromSide({ kind: "rev", rev: "HEAD" })).toEqual({
      kind: "rev",
      revspec: "HEAD",
    });
  });

  it("maps `none` to no side at all", () => {
    expect(imageSourceFromSide({ kind: "none" })).toBe(null);
  });
});
