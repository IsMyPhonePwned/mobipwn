//! Internal detection rules used only as `alerts.rule_id` FK targets for IronSift findings.
//! Not listed in the Rules UI and not executed by the mPL scheduler.

use mobipwn_core::detection::DetectionRule;
use sqlx::PgPool;
use uuid::Uuid;

use crate::constants::{IRONSIFT_FILE_RULE_ID, IRONSIFT_FLEET_RULE_ID, IRONSIFT_TEMPORAL_RULE_ID};

const SYSTEM_RULES: [(Uuid, &str, &str, &str, &str); 3] = [
    (
        IRONSIFT_FLEET_RULE_ID,
        "IronSift fleet anomaly",
        "System rule for IronSift fleet clustering findings (not executed via mPL).",
        "source_type=ironsift source=fleet",
        "high",
    ),
    (
        IRONSIFT_TEMPORAL_RULE_ID,
        "IronSift temporal change",
        "System rule for IronSift temporal diff findings (not executed via mPL).",
        "source_type=ironsift source=temporal",
        "medium",
    ),
    (
        IRONSIFT_FILE_RULE_ID,
        "IronSift file fleet anomaly",
        "System rule for IronSift file fleet findings (not executed via mPL).",
        "source_type=ironsift source=file",
        "high",
    ),
];

pub fn is_system_rule_id(id: &Uuid) -> bool {
    SYSTEM_RULES.iter().any(|(rule_id, ..)| rule_id == id)
}

pub fn filter_public_rules(rules: Vec<DetectionRule>) -> Vec<DetectionRule> {
    rules
        .into_iter()
        .filter(|r| !is_system_rule_id(&r.id))
        .collect()
}

/// Ensure internal IronSift alert FK rules exist (idempotent).
pub async fn ensure_system_rules(pool: &PgPool) -> anyhow::Result<()> {
    for (id, name, description, query, severity) in SYSTEM_RULES {
        sqlx::query(
            "INSERT INTO detection_rules (id, name, description, lifecycle, mode, query, severity, enabled, signal_log_enabled) \
             VALUES ($1, $2, $3, 'alerting', 'scheduled', $4, $5, false, false) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(query)
        .bind(severity)
        .execute(pool)
        .await?;
    }
    Ok(())
}
