//! Reading and writing a file the USER picked in a native dialog (#435).
//!
//! Theme and settings export used to write its file with a blob URL and an
//! `<a download>` click, which WebKitGTK ignores — so on Linux the button did
//! nothing at all. These commands are the native replacement, and the property
//! worth asserting is that they are boring: an exact round trip, and a refusal
//! rather than a surprise for every input that is not a writable file.

use platypusgit_lib::commands::userfile::{read_user_file, write_user_file, MAX_USER_FILE_BYTES};
use platypusgit_lib::error::AppError;

#[tokio::test]
async fn round_trips_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("my-theme.pgtheme.json");
    let body = "{\n  \"name\": \"My theme\"\n}\n";

    write_user_file(path.to_string_lossy().to_string(), body.to_string())
        .await
        .expect("write should succeed");

    let read = read_user_file(path.to_string_lossy().to_string())
        .await
        .expect("read should succeed");
    assert_eq!(read, body);
}

#[tokio::test]
async fn write_truncates_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("theme.json");
    let p = path.to_string_lossy().to_string();

    write_user_file(p.clone(), "a-much-longer-first-write".to_string())
        .await
        .unwrap();
    write_user_file(p.clone(), "short".to_string()).await.unwrap();

    assert_eq!(read_user_file(p).await.unwrap(), "short");
}

#[tokio::test]
async fn read_reports_a_missing_file_as_io() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nope.json");
    match read_user_file(path.to_string_lossy().to_string()).await {
        Err(AppError::Io(_)) => {}
        other => panic!("expected Io for a missing file, got {other:?}"),
    }
}

#[tokio::test]
async fn read_refuses_a_directory() {
    let dir = tempfile::tempdir().unwrap();
    match read_user_file(dir.path().to_string_lossy().to_string()).await {
        Err(AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath for a directory, got {other:?}"),
    }
}

#[tokio::test]
async fn read_refuses_an_oversized_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.json");
    // One byte over the cap is enough: the check is on metadata, so the test
    // does not need to write a realistic 4 MiB of JSON to prove the refusal.
    let big = vec![b'x'; (MAX_USER_FILE_BYTES + 1) as usize];
    std::fs::write(&path, big).unwrap();

    match read_user_file(path.to_string_lossy().to_string()).await {
        Err(AppError::InvalidPath(m)) => {
            assert!(m.contains("too large"), "the refusal should say why: {m}")
        }
        other => panic!("expected InvalidPath for an oversized file, got {other:?}"),
    }
}

#[tokio::test]
async fn write_refuses_an_empty_path() {
    match write_user_file(String::new(), "x".to_string()).await {
        Err(AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath for an empty path, got {other:?}"),
    }
}

#[tokio::test]
async fn read_refuses_an_empty_path() {
    match read_user_file("   ".to_string()).await {
        Err(AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath for a blank path, got {other:?}"),
    }
}

#[tokio::test]
async fn write_does_not_create_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("no-such-dir").join("theme.json");
    match write_user_file(path.to_string_lossy().to_string(), "x".to_string()).await {
        Err(AppError::Io(_)) => {}
        other => panic!("expected Io when the parent is missing, got {other:?}"),
    }
    assert!(
        !dir.path().join("no-such-dir").exists(),
        "a webview string must not be able to mkdir"
    );
}
