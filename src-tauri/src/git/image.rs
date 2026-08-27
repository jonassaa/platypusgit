//! Image previews for the diff surfaces (#224).
//!
//! Everything here is PURE — magic-byte sniffing and LFS object-path building,
//! no repository, no filesystem, no spawn. Same reasoning as `reveal.rs`'s argv
//! planners: the interesting decisions are table-testable, and the only impure
//! part (reading a blob) stays in `libgit2.rs` where the per-repo lock lives.
//!
//! # Detect, don't assume
//!
//! The format is decided by the BYTES, never by the extension. A repository is
//! untrusted input: `logo.png` holding a PDF must reach the same honest empty
//! state as `notes.txt`, because a broken `<img>` is worse than a sentence. That
//! also makes the reverse work — an image committed with no extension at all
//! still previews.
//!
//! # SVG is deliberately NOT previewed
//!
//! SVG is the one entry on the "formats a webview can display" list that is not
//! inert. It carries `<script>`, `<foreignObject>` HTML, external `href` /
//! `xlink:href` / CSS `url()` references and `@import` — i.e. both script
//! execution and outbound requests, from a file that arrived in a `git clone`.
//!
//! Rendering it through `<img src="data:image/svg+xml,…">` is *supposed* to be
//! safe (the SVG-in-image "secure static mode" forbids scripting and external
//! resource loads), and that is what a browser relies on. This app does not take
//! that bet, for two reasons specific to it:
//!
//! * `tauri.conf.json` ships `"csp": null`, so there is no second line of
//!   defense behind the engine's behaviour. One engine bug, or one future
//!   refactor from `<img>` to inline SVG, is script execution inside a webview
//!   with unrestricted Tauri IPC — every git op, the forge tokens, the
//!   filesystem.
//! * Buying the guarantee back by "sanitizing" the XML here is not a boundary
//!   worth standing behind: entities, encodings, CDATA and namespace tricks all
//!   defeat a text scan, and a scan that *looks* like a boundary is worse than
//!   none.
//!
//! So SVG is recognised and refused *by name* — [`UnsupportedReason::Svg`] —
//! rather than silently falling through to "not an image". The surfaces say
//! "SVG previews are disabled", which is a decision; rendering nothing and
//! saying nothing would read as a bug.

use std::path::{Path, PathBuf};

/// Largest blob we will hand to a preview, per side.
///
/// A few MB, in the issue's words. It covers every image a repository has any
/// business holding — icons, screenshots, design exports, test fixtures — and
/// bounds ONE selection at two sides × 4 MiB ≈ 11 MB of base64, the same order
/// as the whole-file text `read_file_content` already ships over IPC.
///
/// Enforced before the bytes are read (worktree: `metadata().len()`; a blob:
/// `Blob::size()`), so an oversized file is never loaded, never encoded and
/// never crosses IPC — it becomes `ImagePreview::TooLarge`.
pub const MAX_PREVIEW_BYTES: u64 = 4 * 1024 * 1024;

/// A pointer file is three short lines; nothing larger is worth parsing as one.
/// Mirrors `lfs::MAX_POINTER_LINES`'s reasoning, in bytes, so the LFS probe on
/// the byte reader costs a length comparison for every real image.
pub const MAX_POINTER_BYTES: u64 = 1024;

/// What a webview can display, and therefore what we will preview.
///
/// The media type is what reaches the `data:` URL, so it has to be the type the
/// bytes actually are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sniffed {
    /// Displayable. Carries the media type for the `data:` URL.
    Image(&'static str),
    /// Recognised as SVG and refused on purpose — see the module doc.
    Svg,
    /// Not an image format we render.
    NotAnImage,
}

/// Longest prefix any rule below inspects. Callers may sniff a HEAD slice.
pub const SNIFF_PREFIX_BYTES: usize = 512;

/// Decide what `bytes` are, from the bytes alone.
///
/// Every rule checks enough of the header to be a real answer: a two-byte `BM`
/// or a bare `\xFF\xD8` matches far too much, so BMP additionally requires its
/// reserved field to be zero and a plausible pixel-array offset, and ICO
/// requires a non-zero image count. A TRUNCATED file — the first four bytes of
/// a PNG signature and nothing else — is not an image, and must answer
/// `NotAnImage` rather than producing an `<img>` that renders as a broken icon.
pub fn sniff(bytes: &[u8]) -> Sniffed {
    if is_png(bytes) {
        return Sniffed::Image("image/png");
    }
    if is_jpeg(bytes) {
        return Sniffed::Image("image/jpeg");
    }
    if is_gif(bytes) {
        return Sniffed::Image("image/gif");
    }
    if is_webp(bytes) {
        return Sniffed::Image("image/webp");
    }
    if is_bmp(bytes) {
        return Sniffed::Image("image/bmp");
    }
    if is_ico(bytes) {
        return Sniffed::Image("image/x-icon");
    }
    if is_svg(bytes) {
        return Sniffed::Svg;
    }
    Sniffed::NotAnImage
}

/// `\x89PNG\r\n\x1a\n`, then the mandatory `IHDR` chunk. The signature alone is
/// eight bytes a truncated download also has.
fn is_png(b: &[u8]) -> bool {
    b.len() >= 16 && b.starts_with(b"\x89PNG\r\n\x1a\n") && &b[12..16] == b"IHDR"
}

/// SOI + the first marker byte. Every JPEG starts `FF D8 FF`, and the fourth
/// byte is a marker id (never `FF 00`, which is a stuffed byte inside a scan).
fn is_jpeg(b: &[u8]) -> bool {
    b.len() >= 4 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF && b[3] != 0x00
}

fn is_gif(b: &[u8]) -> bool {
    // Header + the 7-byte logical screen descriptor that always follows it.
    b.len() >= 13 && (b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"))
}

/// RIFF container whose form type is `WEBP`, plus one of the three real chunk
/// ids — a bare `RIFF….WEBP` with no chunk is not something to hand an `<img>`.
fn is_webp(b: &[u8]) -> bool {
    b.len() >= 16
        && b.starts_with(b"RIFF")
        && &b[8..12] == b"WEBP"
        && matches!(&b[12..16], b"VP8 " | b"VP8L" | b"VP8X")
}

/// `BM` is two bytes of ASCII that any text file could open with, so the header
/// has to corroborate: bytes 6..10 are reserved and zero in every real BMP, and
/// the pixel-array offset must clear the 14-byte file header.
fn is_bmp(b: &[u8]) -> bool {
    if b.len() < 26 || !b.starts_with(b"BM") {
        return false;
    }
    let reserved = u32::from_le_bytes([b[6], b[7], b[8], b[9]]);
    let pixel_offset = u32::from_le_bytes([b[10], b[11], b[12], b[13]]);
    reserved == 0 && pixel_offset >= 26
}

/// ICONDIR: reserved 0, type 1 (icon; type 2 is a cursor, which `<img>` does
/// not display), then a non-zero image count.
fn is_ico(b: &[u8]) -> bool {
    b.len() >= 22 && b[0] == 0 && b[1] == 0 && b[2] == 1 && b[3] == 0 && {
        let count = u16::from_le_bytes([b[4], b[5]]);
        count > 0
    }
}

/// SVG, recognised so it can be refused by name (see the module doc).
///
/// Text, so it is sniffed as text: UTF-8, then the first tag after any BOM,
/// whitespace, XML declaration, comment or DOCTYPE must be `<svg`. That last
/// part matters — an HTML page mentioning `<svg>` halfway down is not an SVG
/// file, and calling it one would replace a repository's `index.html` preview
/// with a refusal notice.
fn is_svg(b: &[u8]) -> bool {
    let head = &b[..b.len().min(SNIFF_PREFIX_BYTES)];
    let Ok(text) = std::str::from_utf8(head) else {
        // A prefix cut mid-codepoint is still worth reading up to the cut.
        let cut = head
            .iter()
            .rposition(|c| c.is_ascii())
            .map(|i| i + 1)
            .unwrap_or(0);
        return std::str::from_utf8(&head[..cut]).is_ok_and(svg_root);
    };
    svg_root(text)
}

/// True when the first element of this XML text is `<svg`.
fn svg_root(text: &str) -> bool {
    let mut rest = text.trim_start_matches('\u{feff}').trim_start();
    loop {
        // `<?xml …?>`, `<!-- … -->`, `<!DOCTYPE …>` — the only things allowed to
        // precede the root element. Anything else decides the answer.
        let skipped = if let Some(after) = rest.strip_prefix("<?") {
            after.find("?>").map(|i| &after[i + 2..])
        } else if let Some(after) = rest.strip_prefix("<!--") {
            after.find("-->").map(|i| &after[i + 3..])
        } else if rest.len() >= 9 && rest[..9].eq_ignore_ascii_case("<!doctype") {
            rest[9..].find('>').map(|i| &rest[9 + i + 1..])
        } else {
            None
        };
        match skipped {
            Some(next) => rest = next.trim_start(),
            None => break,
        }
    }
    let Some(after) = rest.strip_prefix("<svg") else {
        return false;
    };
    // `<svg>`, `<svg …>`, `<svg/>` — but not `<svgfoo>`.
    after.is_empty() || after.starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/')
}

/// Where git-lfs stores object `oid` under a storage directory.
///
/// `<storage>/objects/aa/bb/<oid>` — git-lfs's own fan-out, two levels of two
/// hex characters. Built here, PURE, rather than asked of the `git lfs` binary:
/// the whole point of the LFS branch is to preview an object that IS present,
/// and requiring the binary would refuse that on a machine where git-lfs is not
/// installed but the object happens to be in `.git/lfs`. It also keeps this
/// reader off `proc.rs` entirely.
///
/// `None` for an oid that is not plain lowercase hex of sane length — an oid
/// reaches this from a pointer FILE in the repository, so it is attacker-
/// controlled text and must never be able to build `…/objects/../../..`.
pub fn lfs_object_path(storage: &Path, oid: &str) -> Option<PathBuf> {
    if oid.len() < 4
        || oid.len() > 128
        || !oid.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return None;
    }
    Some(storage.join("objects").join(&oid[0..2]).join(&oid[2..4]).join(oid))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal-but-real headers. Each is the shortest byte string the matching
    /// rule accepts, so a rule that got looser would stop being pinned by it.
    fn png() -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
        v.extend_from_slice(&[0, 0, 0, 13]);
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&[0u8; 13]);
        v
    }
    fn jpeg() -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0];
        v.extend_from_slice(b"\x00\x10JFIF\0");
        v
    }
    fn gif() -> Vec<u8> {
        let mut v = b"GIF89a".to_vec();
        v.extend_from_slice(&[1, 0, 1, 0, 0, 0, 0]);
        v
    }
    fn webp() -> Vec<u8> {
        let mut v = b"RIFF".to_vec();
        v.extend_from_slice(&24u32.to_le_bytes());
        v.extend_from_slice(b"WEBPVP8 ");
        v.extend_from_slice(&[0u8; 8]);
        v
    }
    fn bmp() -> Vec<u8> {
        let mut v = b"BM".to_vec();
        v.extend_from_slice(&70u32.to_le_bytes()); // file size
        v.extend_from_slice(&0u32.to_le_bytes()); // reserved
        v.extend_from_slice(&54u32.to_le_bytes()); // pixel offset
        v.extend_from_slice(&[0u8; 12]);
        v
    }
    fn ico() -> Vec<u8> {
        let mut v = vec![0, 0, 1, 0, 1, 0];
        v.extend_from_slice(&[0u8; 16]);
        v
    }

    #[test]
    fn recognises_every_displayable_format() {
        assert_eq!(sniff(&png()), Sniffed::Image("image/png"));
        assert_eq!(sniff(&jpeg()), Sniffed::Image("image/jpeg"));
        assert_eq!(sniff(&gif()), Sniffed::Image("image/gif"));
        assert_eq!(sniff(&webp()), Sniffed::Image("image/webp"));
        assert_eq!(sniff(&bmp()), Sniffed::Image("image/bmp"));
        assert_eq!(sniff(&ico()), Sniffed::Image("image/x-icon"));
    }

    #[test]
    fn gif87a_is_a_gif_too() {
        let mut v = b"GIF87a".to_vec();
        v.extend_from_slice(&[1, 0, 1, 0, 0, 0, 0]);
        assert_eq!(sniff(&v), Sniffed::Image("image/gif"));
    }

    #[test]
    fn every_webp_chunk_id_counts() {
        for chunk in [b"VP8 ", b"VP8L", b"VP8X"] {
            let mut v = b"RIFF".to_vec();
            v.extend_from_slice(&24u32.to_le_bytes());
            v.extend_from_slice(b"WEBP");
            v.extend_from_slice(chunk);
            v.extend_from_slice(&[0u8; 8]);
            assert_eq!(sniff(&v), Sniffed::Image("image/webp"), "{chunk:?}");
        }
    }

    #[test]
    fn a_truncated_header_is_not_an_image() {
        // The exact failure the sniff exists to prevent: enough bytes to LOOK
        // like a PNG, not enough to be one. An `<img>` renders these broken.
        assert_eq!(sniff(b"\x89PNG"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n"), Sniffed::NotAnImage);
        assert_eq!(sniff(&[0xFF, 0xD8]), Sniffed::NotAnImage);
        assert_eq!(sniff(b"GIF89a"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"RIFF\x18\x00\x00\x00WEBP"), Sniffed::NotAnImage);
        assert_eq!(sniff(b""), Sniffed::NotAnImage);
    }

    #[test]
    fn plain_text_that_starts_with_bm_is_not_a_bitmap() {
        // "BM" is two ASCII letters; a lyric sheet must not preview as an image.
        assert_eq!(sniff(b"BMW ownership notes\n\nThe car is fine.\n"), Sniffed::NotAnImage);
    }

    #[test]
    fn a_cursor_is_not_an_icon() {
        // ICONDIR type 2 is `.cur`, which `<img>` does not display.
        let mut v = vec![0, 0, 2, 0, 1, 0];
        v.extend_from_slice(&[0u8; 16]);
        assert_eq!(sniff(&v), Sniffed::NotAnImage);
        // ...and an icon claiming zero images is not one either.
        let mut empty = vec![0, 0, 1, 0, 0, 0];
        empty.extend_from_slice(&[0u8; 16]);
        assert_eq!(sniff(&empty), Sniffed::NotAnImage);
    }

    #[test]
    fn other_binaries_keep_the_empty_state() {
        // Explicitly out of scope (#224): PDFs, fonts, archives, executables.
        assert_eq!(sniff(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"\x00\x01\x00\x00\x00\x0ftrue"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"PK\x03\x04\x14\x00\x00\x00"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"\x7fELF\x02\x01\x01\x00"), Sniffed::NotAnImage);
    }

    #[test]
    fn a_file_whose_extension_lies_is_judged_by_its_bytes() {
        // `sniff` never sees a name — this pins that the CONTENT decides, which
        // is what makes `logo.png` holding a PDF reach the honest empty state.
        assert_eq!(sniff(b"%PDF-1.4\ntrust me I am a png\n"), Sniffed::NotAnImage);
    }

    #[test]
    fn svg_is_recognised_and_refused_by_name() {
        // The `xmlns` value is spelled with a placeholder on purpose: the real
        // SVG namespace is a w3.org URI, and `tests/no_telemetry.rs` allow-lists
        // every hostname baked into this tree. A fixture is not worth an entry —
        // and the sniff never looks at the attribute anyway.
        assert_eq!(sniff(b"<svg xmlns=\"ns\"/>"), Sniffed::Svg);
        assert_eq!(sniff(b"<svg>"), Sniffed::Svg);
        assert_eq!(
            sniff(b"<?xml version=\"1.0\"?>\n<!-- made by hand -->\n<svg width=\"1\"/>"),
            Sniffed::Svg,
        );
        assert_eq!(
            sniff("\u{feff}<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"x.dtd\">\n<svg />".as_bytes()),
            Sniffed::Svg,
        );
    }

    #[test]
    fn html_that_merely_contains_an_svg_tag_is_not_an_svg_file() {
        // Otherwise every `index.html` in every repository would render the
        // "SVG previews are disabled" notice instead of its own preview.
        assert_eq!(sniff(b"<!DOCTYPE html>\n<html><body><svg/></body></html>"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"<svgfoo/>"), Sniffed::NotAnImage);
        assert_eq!(sniff(b"const s = \"<svg/>\";\n"), Sniffed::NotAnImage);
    }

    #[test]
    fn lfs_object_paths_fan_out_the_way_git_lfs_does() {
        let p = lfs_object_path(Path::new("/r/.git/lfs"), "abcdef0123").unwrap();
        assert_eq!(p, Path::new("/r/.git/lfs/objects/ab/cd/abcdef0123"));
    }

    #[test]
    fn an_oid_that_is_not_hex_can_never_build_a_path() {
        // The oid comes from a pointer FILE in an untrusted repository.
        assert!(lfs_object_path(Path::new("/r/.git/lfs"), "../../../etc/passwd").is_none());
        assert!(lfs_object_path(Path::new("/r/.git/lfs"), "ab/cd").is_none());
        assert!(lfs_object_path(Path::new("/r/.git/lfs"), "ABCDEF01").is_none());
        assert!(lfs_object_path(Path::new("/r/.git/lfs"), "ab").is_none());
        assert!(lfs_object_path(Path::new("/r/.git/lfs"), "").is_none());
    }
}
