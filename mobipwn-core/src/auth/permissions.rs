use serde::{Deserialize, Serialize};

/// Fine-grained API / UI capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    SearchRun,
    SearchExport,
    AlertsRead,
    AlertsWrite,
    RulesRead,
    RulesWrite,
    CasesRead,
    CasesWrite,
    IngestWrite,
    DashboardsRead,
    DashboardsWrite,
    SavedQueriesWrite,
    MarketplaceRead,
    MarketplaceWrite,
    SettingsRead,
    SettingsWrite,
    UsersAdmin,
    DataAdmin,
    HealthRead,
    NotificationsWrite,
    LlmUse,
    IronSiftRead,
    IronSiftWrite,
}

use super::ApiRole;

impl ApiRole {
    pub fn has(self, perm: Permission) -> bool {
        if self == ApiRole::Admin {
            return true;
        }
        match self {
            ApiRole::Admin => true,
            ApiRole::Analyst => matches!(
                perm,
                Permission::SearchRun
                    | Permission::SearchExport
                    | Permission::AlertsRead
                    | Permission::AlertsWrite
                    | Permission::RulesRead
                    | Permission::RulesWrite
                    | Permission::CasesRead
                    | Permission::CasesWrite
                    | Permission::IngestWrite
                    | Permission::DashboardsRead
                    | Permission::DashboardsWrite
                    | Permission::SavedQueriesWrite
                    | Permission::MarketplaceRead
                    | Permission::MarketplaceWrite
                    | Permission::HealthRead
                    | Permission::LlmUse
                    | Permission::IronSiftRead
                    | Permission::IronSiftWrite
            ),
            ApiRole::Viewer => matches!(
                perm,
                Permission::SearchRun
                    | Permission::SearchExport
                    | Permission::AlertsRead
                    | Permission::RulesRead
                    | Permission::CasesRead
                    | Permission::DashboardsRead
                    | Permission::MarketplaceRead
                    | Permission::HealthRead
                    | Permission::IronSiftRead
            ),
        }
    }

    pub fn permissions(self) -> Vec<Permission> {
        [
            Permission::SearchRun,
            Permission::SearchExport,
            Permission::AlertsRead,
            Permission::AlertsWrite,
            Permission::RulesRead,
            Permission::RulesWrite,
            Permission::CasesRead,
            Permission::CasesWrite,
            Permission::IngestWrite,
            Permission::DashboardsRead,
            Permission::DashboardsWrite,
            Permission::SavedQueriesWrite,
            Permission::MarketplaceRead,
            Permission::MarketplaceWrite,
            Permission::SettingsRead,
            Permission::SettingsWrite,
            Permission::UsersAdmin,
            Permission::DataAdmin,
            Permission::HealthRead,
            Permission::NotificationsWrite,
            Permission::LlmUse,
            Permission::IronSiftRead,
            Permission::IronSiftWrite,
        ]
        .into_iter()
        .filter(|p| self.has(*p))
        .collect()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ApiRole::Admin => "admin",
            ApiRole::Analyst => "analyst",
            ApiRole::Viewer => "viewer",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ApiRole, Permission};

    #[test]
    fn viewer_is_read_only() {
        assert!(ApiRole::Viewer.has(Permission::SearchRun));
        assert!(ApiRole::Viewer.has(Permission::AlertsRead));
        assert!(!ApiRole::Viewer.has(Permission::AlertsWrite));
        assert!(!ApiRole::Viewer.has(Permission::RulesWrite));
        assert!(!ApiRole::Viewer.has(Permission::SettingsRead));
    }

    #[test]
    fn analyst_can_operate_but_not_administer() {
        assert!(ApiRole::Analyst.has(Permission::AlertsWrite));
        assert!(ApiRole::Analyst.has(Permission::IngestWrite));
        assert!(!ApiRole::Analyst.has(Permission::UsersAdmin));
        assert!(!ApiRole::Analyst.has(Permission::SettingsWrite));
    }
}
