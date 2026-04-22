use git2::{Repository, Signature};

use crate::error::{AppError, AppResult};

/// Resolve a `Signature` from the repository's config.
///
/// Priority: repo-local config → global → system. Fails with
/// `AppError::NoSignature` when `user.name` or `user.email` is missing.
pub fn default_signature<'a>(repo: &'a Repository) -> AppResult<Signature<'a>> {
    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(e) => {
            if e.code() == git2::ErrorCode::NotFound {
                Err(AppError::NoSignature)
            } else {
                Err(e.into())
            }
        }
    }
}
