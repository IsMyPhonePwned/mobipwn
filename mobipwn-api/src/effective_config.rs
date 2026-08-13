use mobipwn_core::{effective_app_config, AppConfig};

use crate::AppState;

impl AppState {
    pub async fn effective_config(&self) -> AppConfig {
        effective_app_config(&self.settings, &self.config)
            .await
            .unwrap_or_else(|_| self.config.clone())
    }
}
