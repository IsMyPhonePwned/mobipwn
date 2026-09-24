use serde::{Deserialize, Serialize};

pub const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupSection {
    Config,
    Rules,
    Alerts,
    Cases,
    Marketplace,
    Ingest,
    Events,
    Enrichments,
    Auth,
}

impl BackupSection {
    pub fn all() -> &'static [BackupSection] {
        &[
            BackupSection::Config,
            BackupSection::Rules,
            BackupSection::Alerts,
            BackupSection::Cases,
            BackupSection::Marketplace,
            BackupSection::Ingest,
            BackupSection::Events,
            BackupSection::Enrichments,
            BackupSection::Auth,
        ]
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Config => "config",
            Self::Rules => "rules",
            Self::Alerts => "alerts",
            Self::Cases => "cases",
            Self::Marketplace => "marketplace",
            Self::Ingest => "ingest",
            Self::Events => "events",
            Self::Enrichments => "enrichments",
            Self::Auth => "auth",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Config => "Platform configuration",
            Self::Rules => "Detection rules",
            Self::Alerts => "Alerts & activity",
            Self::Cases => "Cases & hunts",
            Self::Marketplace => "Marketplace providers",
            Self::Ingest => "Ingest job metadata",
            Self::Events => "ClickHouse events",
            Self::Enrichments => "ClickHouse enrichments",
            Self::Auth => "Users & API keys",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Config => "siem_settings, notifications, suppressions",
            Self::Rules => "rules, folders, repositories, versions",
            Self::Alerts => "alerts, groups, alert comments",
            Self::Cases => "cases, dashboards, saved queries, search history",
            Self::Marketplace => "enrichment provider definitions",
            Self::Ingest => "upload/ingest job records (not archive files)",
            Self::Events => "all rows in mobipwn.events (can be large)",
            Self::Enrichments => "IP/IOC/package/asset enrichment tables",
            Self::Auth => "users and API keys (secrets redacted on export)",
        }
    }

    pub fn from_id(s: &str) -> Option<Self> {
        Self::all().iter().copied().find(|sec| sec.id() == s)
    }

    pub fn postgres_tables(self) -> &'static [&'static str] {
        match self {
            Self::Config => &[
                "siem_settings",
                "notification_channels",
                "suppression_windows",
            ],
            Self::Rules => &[
                "rule_repositories",
                "rule_folders",
                "detection_rules",
                "detection_rule_versions",
                "detection_runs",
            ],
            Self::Alerts => &["alert_groups", "alerts", "alert_events"],
            Self::Cases => &[
                "cases",
                "dashboards",
                "saved_query_folders",
                "saved_queries",
                "search_history",
            ],
            Self::Marketplace => &["enrichment_providers"],
            Self::Ingest => &["ingest_jobs"],
            Self::Auth => &["users", "api_keys"],
            Self::Events | Self::Enrichments => &[],
        }
    }

    pub fn postgres_import_order(self) -> &'static [&'static str] {
        match self {
            Self::Config => &[
                "suppression_windows",
                "notification_channels",
                "siem_settings",
            ],
            Self::Rules => &[
                "rule_repositories",
                "rule_folders",
                "detection_rules",
                "detection_rule_versions",
                "detection_runs",
            ],
            Self::Alerts => &["alert_groups", "alerts", "alert_events"],
            Self::Cases => &[
                "cases",
                "dashboards",
                "saved_query_folders",
                "saved_queries",
                "search_history",
            ],
            Self::Marketplace => &["enrichment_providers"],
            Self::Ingest => &["ingest_jobs"],
            Self::Auth => &["users", "api_keys"],
            Self::Events | Self::Enrichments => &[],
        }
    }

    pub fn clickhouse_tables(self) -> &'static [&'static str] {
        match self {
            Self::Events => &["events"],
            Self::Enrichments => &[
                "ip_enrichments",
                "ioc_enrichments",
                "custom_enrichment_results",
                "asset_enrichments",
                "package_enrichments",
            ],
            _ => &[],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSectionInfo {
    pub id: String,
    pub label: String,
    pub description: String,
}

pub fn list_section_info() -> Vec<BackupSectionInfo> {
    BackupSection::all()
        .iter()
        .map(|sec| BackupSectionInfo {
            id: sec.id().to_string(),
            label: sec.label().to_string(),
            description: sec.description().to_string(),
        })
        .collect()
}
