/**
 * @vitest-environment node
 */
// The Store package's app-list icons must stay TRANSPARENT (#390).
//
// The whole unplated-icon fix rests on one premise: this mark carries no
// background of its own, so Windows has nothing to gain by plating it. Re-render
// the ladder with a tool that bakes in a background — or from a master that
// grew one — and the user-visible symptom is *the same coloured box behind the
// icon* that #390 removed, arriving through a completely different door. None of
// the guards in `msix_identity.rs` can see it: they check names, lists and
// ordering, never pixels.
//
// docs/dev/distribution.md already says "verify transparency, don't eyeball it"
// and explains why — a PNG can carry an alpha channel and still be fully opaque,
// which the original icon set did (`hasAlpha: yes`, every corner α=255). This
// turns that instruction into a build failure.
//
// NO IMAGE LIBRARY, deliberately. `png` is already in Cargo.lock (transitively,
// twice) so a Rust version of this test was available for the price of a
// dev-dependency — but `msix_identity.rs` states the trade this project makes
// for exactly this shape of assertion: "one dependency for one assertion is the
// wrong trade", written there about not adding an XML crate. Node ships zlib,
// and the subset of PNG these files use (8-bit RGBA, non-interlaced, as emitted
// by both supported renderers) is ~40 lines to decode.
//
// Lives in `test/` rather than `src/` for the same reason `docs.test.ts` does:
// it asserts things about `src-tauri/`, and is not a frontend test in any sense.

import { readFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LADDER = resolve(process.cwd(), "src-tauri/icons/msix");

type Decoded = { width: number; height: number; pixels: Buffer };

/** 8-bit RGBA, non-interlaced PNG → raw pixels. Throws on anything else. */
function decodePng(buf: Buffer): Decoded {
  let offset = 8; // 8-byte signature
  let header: { width: number; height: number } | null = null;
  const idat: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      // Colour type 6 is RGBA — the only one carrying the alpha this test is
      // about. A renderer that emitted RGB (type 2) has flattened the icon onto
      // something, which is precisely the regression being caught, so this
      // throws rather than skipping.
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error(
          `not an 8-bit non-interlaced RGBA PNG (depth=${depth} colour=${colour} interlace=${interlace}) — ` +
            `colour type 2 means the alpha channel is gone and the icon has been flattened onto a background`,
        );
      }
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4) };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // length + type + data + CRC
  }
  if (!header) throw new Error("no IHDR chunk");

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = header.width * bpp;
  const pixels = Buffer.alloc(header.height * stride);

  // Undo the per-scanline filters (PNG spec §9.2). Each line is prefixed with
  // its filter type and is decoded against the already-reconstructed line above.
  let pos = 0;
  for (let y = 0; y < header.height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prior =
      y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; // left
      const b = prior[x]; // above
      const c = x >= bpp ? prior[x - bpp] : 0; // upper-left
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`unknown scanline filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }
  return { ...header, pixels };
}

const alphaAt = ({ pixels, width }: Decoded, x: number, y: number) =>
  pixels[(y * width + x) * 4 + 3];

const ladder = readdirSync(LADDER)
  .filter((f) => f.endsWith(".png"))
  .sort();

describe("the Store package's target-size app icons", () => {
  it("has a ladder at all", () => {
    // A vacuous pass is the one way this file could fail to do its job: an
    // empty directory would satisfy every `it.each` below without running one.
    expect(ladder.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ladder)("%s is transparent at every corner, and is not blank", (name) => {
    const img = decodePng(readFileSync(join(LADDER, name)));

    const size = Number(name.match(/targetsize-(\d+)/)?.[1]);
    expect(
      { width: img.width, height: img.height },
      `${name} is not ${size}x${size}. Windows asks for an EXACT pixel size; a ` +
        `mismatch is silently rescaled, which is what the ladder exists to avoid.`,
    ).toEqual({ width: size, height: size });

    const corners = {
      topLeft: alphaAt(img, 0, 0),
      topRight: alphaAt(img, img.width - 1, 0),
      bottomLeft: alphaAt(img, 0, img.height - 1),
      bottomRight: alphaAt(img, img.width - 1, img.height - 1),
    };
    expect(
      corners,
      `${name} has an opaque corner, so it carries a background plate of its ` +
        `own. That is the regression #390 removed, arriving from the other ` +
        `side: the user still sees a coloured box behind the taskbar icon, and ` +
        `no amount of _altform-unplated staging can undo a background baked ` +
        `into the pixels. Re-render with sh scripts/gen-msix-appicons.sh.`,
    ).toEqual({ topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 });

    // Transparency is trivially satisfied by an empty file, so the same pass
    // has to prove there is an icon in there too.
    let opaque = 0;
    for (let i = 3; i < img.pixels.length; i += 4) {
      if (img.pixels[i] === 255) opaque++;
    }
    expect(
      opaque,
      `${name} has no fully opaque pixel — the render came out empty.`,
    ).toBeGreaterThan(0);
  });
});
