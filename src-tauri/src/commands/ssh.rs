//! Showing and creating an SSH key (#248).
//!
//! Thin over `src-tauri/src/ssh.rs`, which is where every decision and every
//! measured `ssh-keygen` behaviour is written down. Two commands, neither of
//! which takes a repository: an SSH key belongs to the machine, not to a repo.
//!
//! Nothing here returns a private key, and nothing here logs the passphrase.
//! The passphrase arrives in the request, is handed straight to `ssh::generate`
//! (which puts it in the child's ENVIRONMENT, never argv) and is dropped when
//! the future ends.

use crate::{
    error::{AppError, AppResult},
    forge::ForgeKind,
    ssh::{self, GenerateRequest, SshKeyInfo, SshKeyStatus},
};

/// Which keys are on this machine, and where a new one would go.
///
/// `host` is the host the failed remote named (from `AuthChallenge`), used for
/// the add-key link and for a host-specific default file name. Absent when
/// git's stderr did not name one — the panel still works, it just cannot link.
#[tauri::command]
pub async fn ssh_key_status(
    host: Option<String>,
    kind: Option<ForgeKind>,
) -> AppResult<SshKeyStatus> {
    tokio::task::spawn_blocking(move || {
        let dir = ssh::ssh_dir()?;
        Ok(ssh::status(&dir, host.as_deref(), kind))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Create an ed25519 key pair and return its PUBLIC half.
///
/// The askpass is resolved HERE, from `std::env::current_exe()`, rather than
/// inside `ssh::generate` — that is what lets `tests/ssh_keys.rs` drive the
/// passphrase path with a script of its own, since an integration-test binary
/// is not the askpass shim.
#[tauri::command]
pub async fn ssh_key_generate(request: GenerateRequest) -> AppResult<SshKeyInfo> {
    tokio::task::spawn_blocking(move || {
        let dir = ssh::ssh_dir()?;
        let askpass = ssh::askpass_exe();
        ssh::generate(&dir, &request, &askpass)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
