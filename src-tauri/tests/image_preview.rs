//! The fourth file reader: BYTES, sniffed, for the image preview surfaces (#224).
//!
//! `git/image.rs` unit-tests the sniffing table with no repository at all; this
//! file pins the half that needs one — which side each `BlobSource` reads, that
//! the ceiling refuses a blob without loading it, that absence stays a state
//! rather than an error, and that an LFS pointer previews its OBJECT when the
//! object is on this disk and says so when it is not.
//!
//! Fixtures are written as real bytes, never as "a file called `.png`": the
//! whole promise of the feature is that the CONTENT decides, so a fixture that
//! relied on its own extension would test nothing.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::image::MAX_PREVIEW_BYTES;
use platypusgit_lib::git::{
    libgit2::Libgit2Backend,
    types::{BlobSource, ImagePreview, RepoId, UnsupportedReason},
    GitBackend,
};

use support::TempRepo;

/// A real 1×1 PNG, header through IEND. Small enough to inline, complete enough
/// that a browser would render it.
fn png_bytes() -> Vec<u8> {
    let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
    // IHDR: 1x1, 8-bit RGBA
    v.extend_from_slice(&13u32.to_be_bytes());
    v.extend_from_slice(b"IHDR");
    v.extend_from_slice(&1u32.to_be_bytes());
    v.extend_from_slice(&1u32.to_be_bytes());
    v.extend_from_slice(&[8, 6, 0, 0, 0]);
    v.extend_from_slice(&[0x1F, 0x15, 0xC4, 0x89]);
    // IDAT (a valid zlib stream for one transparent pixel)
    let idat: [u8; 13] = [
        0x78, 0x9C, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0x0D,
    ];
    v.extend_from_slice(&(idat.len() as u32).to_be_bytes());
    v.extend_from_slice(b"IDAT");
    v.extend_from_slice(&idat);
    v.extend_from_slice(&[0x0A, 0x2D, 0xB4, 0x00]);
    v.extend_from_slice(&0u32.to_be_bytes());
    v.extend_from_slice(b"IEND");
    v.extend_from_slice(&[0xAE, 0x42, 0x60, 0x82]);
    v
}

fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("parent dirs");
    }
    std::fs::write(&p, bytes).expect("write bytes");
}

fn worktree() -> BlobSource {
    BlobSource::Worktree
}
fn at(rev: &str) -> BlobSource {
    BlobSource::Rev {
        revspec: rev.to_string(),
    }
}

/// Assert an `Image` answer and hand back its media type + base64.
#[track_caller]
fn expect_image(p: Option<ImagePreview>) -> (String, String, u64) {
    match p {
        Some(ImagePreview::Image {
            media_type,
            data,
            size,
            ..
        }) => (media_type, data, size),
        other => panic!("expected an image, got {other:?}"),
    }
}

// ── Which side each source reads ────────────────────────────────────────────

#[test]
fn reads_the_worktree_copy() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "logo.png", &png_bytes());
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_image_preview(&handle.id, &worktree(), Path::new("logo.png"))
        .expect("preview");
    let (media, data, size) = expect_image(out);
    assert_eq!(media, "image/png");
    assert_eq!(size, png_bytes().len() as u64);
    // Base64 of the real bytes, ready to be concatenated into a `data:` URL —
    // nothing on the frontend decodes it, so a wrong encoding is invisible until
    // an image silently fails to render.
    assert!(data.starts_with("iVBORw0KGgo"), "not base64 PNG: {data}");
}

#[test]
fn reads_the_staged_blob() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "logo.png", &png_bytes());
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("logo.png")])
        .expect("stage");
    // Change the worktree AFTER staging: if the index reader were secretly
    // reading the worktree this would come back as "not an image".
    write_bytes(tr.path(), "logo.png", b"scribbled over\n");

    let out = backend
        .read_image_preview(&handle.id, &BlobSource::Index, Path::new("logo.png"))
        .expect("preview");
    let (media, _, _) = expect_image(out);
    assert_eq!(media, "image/png");
}

#[test]
fn reads_a_committed_tree() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "logo.png", &png_bytes());
    tr.commit_all("add logo");
    // Replace it in the worktree with something that is not an image.
    write_bytes(tr.path(), "logo.png", b"deleted the art\n");
    let (backend, handle) = tr.open_with_backend();

    let (media, _, _) = expect_image(
        backend
            .read_image_preview(&handle.id, &at("HEAD"), Path::new("logo.png"))
            .expect("preview"),
    );
    assert_eq!(media, "image/png");

    // ...and the worktree side of the same path is the OTHER answer, which is
    // the whole reason a preview asks for each side by name.
    match backend
        .read_image_preview(&handle.id, &worktree(), Path::new("logo.png"))
        .expect("preview")
    {
        Some(ImagePreview::Unsupported {
            reason: UnsupportedReason::NotAnImage,
            ..
        }) => {}
        other => panic!("expected NotAnImage, got {other:?}"),
    }
}

#[test]
fn reads_a_conflict_stage() {
    // The merge resolver's binary chooser has no other way to name its sides:
    // neither "ours" nor "theirs" is in any tree while the merge is unresolved.
    let tr = support::with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();

    for stage in [2u16, 3u16] {
        let out = backend
            .read_image_preview(
                &handle.id,
                &BlobSource::Stage { stage },
                Path::new("README.md"),
            )
            .expect("preview");
        match out {
            Some(ImagePreview::Unsupported {
                reason: UnsupportedReason::NotAnImage,
                ..
            }) => {}
            other => panic!("stage {stage}: expected NotAnImage, got {other:?}"),
        }
    }
}

// ── The worktree reader does NOT fall back to HEAD ──────────────────────────

#[test]
fn a_deleted_file_has_no_new_side() {
    // `read_file_content` recovers the HEAD blob here, and that is right for a
    // single-file view and wrong for a PAIR: falling back would paint the old
    // image into the "new" slot and claim the delete changed nothing.
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "logo.png", &png_bytes());
    tr.commit_all("add logo");
    std::fs::remove_file(tr.path().join("logo.png")).expect("rm");
    let (backend, handle) = tr.open_with_backend();

    assert!(
        backend
            .read_image_preview(&handle.id, &worktree(), Path::new("logo.png"))
            .expect("absence is a state, not a failure")
            .is_none(),
        "the worktree side of a deleted file must be None, not HEAD's blob",
    );
    // The old side still exists, so the surface renders one panel.
    expect_image(
        backend
            .read_image_preview(&handle.id, &at("HEAD"), Path::new("logo.png"))
            .expect("preview"),
    );
}

// ── Absence, and genuine failure ────────────────────────────────────────────

#[test]
fn a_missing_path_is_a_state_on_every_source() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();
    let nope = Path::new("assets/nope.png");

    for source in [worktree(), BlobSource::Index, at("HEAD"), BlobSource::Stage { stage: 2 }] {
        let out = backend
            .read_image_preview(&handle.id, &source, nope)
            .unwrap_or_else(|e| panic!("{source:?} must not error: {e:?}"));
        assert!(out.is_none(), "{source:?}: expected None, got {out:?}");
    }
}

#[test]
fn a_directory_is_a_state_not_an_image() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "assets/logo.png", &png_bytes());
    tr.commit_all("add logo");
    let (backend, handle) = tr.open_with_backend();

    for source in [worktree(), at("HEAD")] {
        let out = backend
            .read_image_preview(&handle.id, &source, Path::new("assets"))
            .unwrap_or_else(|e| panic!("{source:?} must not error: {e:?}"));
        assert!(out.is_none(), "{source:?}: expected None, got {out:?}");
    }
}

#[test]
fn an_unresolvable_revspec_still_errors() {
    // Absence is a state; a revspec that names nothing is a real failure, and
    // must stay one — the surface has asked a question with no answer.
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();

    match backend.read_image_preview(&handle.id, &at("no-such-ref"), Path::new("README.md")) {
        Err(AppError::InvalidRef(spec)) => assert_eq!(spec, "no-such-ref"),
        other => panic!("expected InvalidRef, got {other:?}"),
    }
}

#[test]
fn an_unknown_repository_still_errors() {
    let backend = Libgit2Backend::new();
    match backend.read_image_preview(
        &RepoId("not-a-repo-id".into()),
        &worktree(),
        Path::new("logo.png"),
    ) {
        Err(AppError::UnknownRepo(_)) => {}
        other => panic!("expected UnknownRepo, got {other:?}"),
    }
}

// ── The ceiling ─────────────────────────────────────────────────────────────

#[test]
fn a_blob_over_the_ceiling_is_refused_without_being_read() {
    let tr = TempRepo::with_initial_commit("v1\n");
    // A real PNG header followed by enough padding to clear the cap: the answer
    // must be TooLarge, NOT "a 5 MB image" — sniffing first and measuring after
    // would defeat the point of having a cap at all.
    let mut huge = png_bytes();
    huge.resize((MAX_PREVIEW_BYTES + 1024) as usize, 0u8);
    write_bytes(tr.path(), "huge.png", &huge);
    tr.commit_all("add a huge png");
    let (backend, handle) = tr.open_with_backend();

    for source in [worktree(), at("HEAD")] {
        match backend
            .read_image_preview(&handle.id, &source, Path::new("huge.png"))
            .expect("preview")
        {
            Some(ImagePreview::TooLarge { size, limit, .. }) => {
                assert_eq!(size, huge.len() as u64);
                assert_eq!(limit, MAX_PREVIEW_BYTES);
            }
            other => panic!("{source:?}: expected TooLarge, got {other:?}"),
        }
    }
}

#[test]
fn a_blob_at_exactly_the_ceiling_is_still_previewed() {
    // Off-by-one on a limit is how "4 MB" quietly becomes "3.999 MB".
    let tr = TempRepo::with_initial_commit("v1\n");
    let mut exact = png_bytes();
    exact.resize(MAX_PREVIEW_BYTES as usize, 0u8);
    write_bytes(tr.path(), "exact.png", &exact);
    let (backend, handle) = tr.open_with_backend();

    let (_, _, size) = expect_image(
        backend
            .read_image_preview(&handle.id, &worktree(), Path::new("exact.png"))
            .expect("preview"),
    );
    assert_eq!(size, MAX_PREVIEW_BYTES);
}

// ── Detect, don't assume ────────────────────────────────────────────────────

#[test]
fn an_extension_that_lies_reaches_the_empty_state() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "logo.png", b"%PDF-1.7\ntrust me\n");
    write_bytes(tr.path(), "half.jpg", b"\xFF\xD8"); // truncated: looks like a JPEG
    let (backend, handle) = tr.open_with_backend();

    for name in ["logo.png", "half.jpg"] {
        match backend
            .read_image_preview(&handle.id, &worktree(), Path::new(name))
            .expect("preview")
        {
            Some(ImagePreview::Unsupported {
                reason: UnsupportedReason::NotAnImage,
                ..
            }) => {}
            other => panic!("{name}: expected NotAnImage, got {other:?}"),
        }
    }
}

#[test]
fn an_image_with_no_extension_still_previews() {
    // The other direction of the same rule: the bytes decide.
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "fixture", &png_bytes());
    let (backend, handle) = tr.open_with_backend();

    let (media, _, _) = expect_image(
        backend
            .read_image_preview(&handle.id, &worktree(), Path::new("fixture"))
            .expect("preview"),
    );
    assert_eq!(media, "image/png");
}

#[test]
fn svg_is_refused_by_name_not_silently() {
    // Deliberate (see git/image.rs): SVG carries script and remote references,
    // and this app ships no CSP behind the `<img>` element. The surfaces have to
    // be able to SAY that, so the refusal is its own reason, not "not an image".
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(
        tr.path(),
        "icon.svg",
        b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>\n",
    );
    let (backend, handle) = tr.open_with_backend();

    match backend
        .read_image_preview(&handle.id, &worktree(), Path::new("icon.svg"))
        .expect("preview")
    {
        Some(ImagePreview::Unsupported {
            reason: UnsupportedReason::Svg,
            size,
            ..
        }) => assert!(size > 0),
        other => panic!("expected Svg, got {other:?}"),
    }
}

// ── git-LFS ─────────────────────────────────────────────────────────────────

/// The pointer file for `oid`/`size`, byte-for-byte as git-lfs writes it.
fn pointer(oid: &str, size: u64) -> String {
    format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {size}\n")
}

const OID: &str = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

#[test]
fn an_lfs_pointer_previews_the_object_when_it_is_present_locally() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let png = png_bytes();
    write_bytes(tr.path(), "art.png", pointer(OID, png.len() as u64).as_bytes());
    // git-lfs's own fan-out under `.git/lfs`. Written directly rather than via
    // the binary: the question is "is the object on this disk", and a machine
    // without git-lfs installed can still answer it.
    write_bytes(
        tr.path(),
        &format!(".git/lfs/objects/{}/{}/{OID}", &OID[0..2], &OID[2..4]),
        &png,
    );
    let (backend, handle) = tr.open_with_backend();

    let (media, _, size) = expect_image(
        backend
            .read_image_preview(&handle.id, &worktree(), Path::new("art.png"))
            .expect("preview"),
    );
    assert_eq!(media, "image/png");
    // The OBJECT's size, not the pointer's — otherwise the panel would report a
    // 130-byte image.
    assert_eq!(size, png.len() as u64);
}

#[test]
fn an_unfetched_lfs_object_says_so_instead_of_rendering_the_pointer() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "art.png", pointer(OID, 4_096).as_bytes());
    let (backend, handle) = tr.open_with_backend();

    match backend
        .read_image_preview(&handle.id, &worktree(), Path::new("art.png"))
        .expect("preview")
    {
        Some(ImagePreview::LfsMissing { oid, size, .. }) => {
            assert_eq!(oid, OID);
            // From the pointer: the surface can say how big the missing thing is.
            assert_eq!(size, 4_096);
        }
        other => panic!("expected LfsMissing, got {other:?}"),
    }
}

#[test]
fn an_lfs_pointer_committed_to_a_tree_resolves_the_same_way() {
    // The pointer is what git stores, so every source can hand one back — the
    // resolution has to live below the source choice, not in the worktree arm.
    let tr = TempRepo::with_initial_commit("v1\n");
    let png = png_bytes();
    write_bytes(tr.path(), "art.png", pointer(OID, png.len() as u64).as_bytes());
    tr.commit_all("add pointer");
    write_bytes(
        tr.path(),
        &format!(".git/lfs/objects/{}/{}/{OID}", &OID[0..2], &OID[2..4]),
        &png,
    );
    let (backend, handle) = tr.open_with_backend();

    let (media, _, _) = expect_image(
        backend
            .read_image_preview(&handle.id, &at("HEAD"), Path::new("art.png"))
            .expect("preview"),
    );
    assert_eq!(media, "image/png");
}

#[test]
fn a_pointer_naming_a_non_image_object_keeps_the_empty_state() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_bytes(tr.path(), "asset.psd", pointer(OID, 8).as_bytes());
    write_bytes(
        tr.path(),
        &format!(".git/lfs/objects/{}/{}/{OID}", &OID[0..2], &OID[2..4]),
        b"8PSD....",
    );
    let (backend, handle) = tr.open_with_backend();

    match backend
        .read_image_preview(&handle.id, &worktree(), Path::new("asset.psd"))
        .expect("preview")
    {
        Some(ImagePreview::Unsupported {
            reason: UnsupportedReason::NotAnImage,
            ..
        }) => {}
        other => panic!("expected NotAnImage, got {other:?}"),
    }
}
