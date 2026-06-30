use std::sync::Arc;

use crate::git::GitBackend;

pub struct AppState {
    pub backend: Arc<dyn GitBackend>,
}

impl AppState {
    pub fn new(backend: Arc<dyn GitBackend>) -> Self {
        Self { backend }
    }
}
