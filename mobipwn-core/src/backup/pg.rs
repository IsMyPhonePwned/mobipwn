use anyhow::{bail, Context};
use serde_json::{json, Value};
use sqlx::PgPool;

use super::sections::BackupSection;

const ALLOWED_TABLES: &[&str] = &[
    "siem_settings",
    "notification_channels",
    "suppression_windows",
    "rule_repositories",
    "rule_folders",
    "detection_rules",
    "detection_rule_versions",
    "detection_runs",
    "alert_groups",
    "alerts",
    "alert_events",
    "cases",
    "dashboards",
    "saved_query_folders",
    "saved_queries",
    "search_history",
    "enrichment_providers",
    "ingest_jobs",
    "ironsift_runs",
    "ironsift_findings",
    "ironsift_triage",
    "ironsift_run_devices",
    "ironsift_anomark_trains",
    "users",
    "api_keys",
];

fn assert_table(table: &str) -> anyhow::Result<()> {
    if ALLOWED_TABLES.contains(&table) {
        Ok(())
    } else {
        bail!("table not allowed for backup: {table}")
    }
}

pub async fn export_table(pool: &PgPool, table: &str) -> anyhow::Result<Vec<Value>> {
    assert_table(table)?;
    let sql = format!(
        "SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) \
         FROM (SELECT * FROM {table} ORDER BY 1) t"
    );
    let value: Value = sqlx::query_scalar(&sql)
        .fetch_one(pool)
        .await
        .with_context(|| format!("export {table}"))?;
    Ok(value
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| !row.is_null())
        .collect())
}

pub async fn export_section_tables(
    pool: &PgPool,
    section: BackupSection,
) -> anyhow::Result<Value> {
    let mut tables = serde_json::Map::new();
    for table in section.postgres_tables() {
        let rows = export_table(pool, table).await?;
        tables.insert((*table).to_string(), Value::Array(rows));
    }
    Ok(Value::Object(tables))
}

pub async fn delete_table(pool: &PgPool, table: &str) -> anyhow::Result<()> {
    assert_table(table)?;
    sqlx::query(&format!("DELETE FROM {table}"))
        .execute(pool)
        .await
        .with_context(|| format!("delete {table}"))?;
    Ok(())
}

pub async fn import_table_rows(
    pool: &PgPool,
    table: &str,
    rows: &[Value],
    merge: bool,
) -> anyhow::Result<u64> {
    assert_table(table)?;
    if rows.is_empty() {
        return Ok(0);
    }
    let mut inserted = 0u64;
    for row in rows {
        if row.is_null() {
            continue;
        }
        let sql = if merge && table == "siem_settings" {
            format!(
                "INSERT INTO {table} SELECT * FROM json_populate_record(null::{table}, $1::json) \
                 ON CONFLICT (key) DO UPDATE SET \
                   value = EXCLUDED.value, updated_at = EXCLUDED.updated_at"
            )
        } else {
            format!(
                "INSERT INTO {table} SELECT * FROM json_populate_record(null::{table}, $1::json)"
            )
        };
        sqlx::query(&sql)
            .bind(row)
            .execute(pool)
            .await
            .with_context(|| format!("import row into {table}"))?;
        inserted += 1;
    }
    Ok(inserted)
}

pub async fn import_section_tables(
    pool: &PgPool,
    section: BackupSection,
    payload: &Value,
    mode_merge: bool,
) -> anyhow::Result<std::collections::HashMap<String, u64>> {
    let tables = payload
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("section payload must be an object"))?;
    let mut counts = std::collections::HashMap::new();

    if mode_merge && section == BackupSection::Config {
        let rows = tables
            .get("siem_settings")
            .and_then(|v| v.as_array())
            .map(|a| a.as_slice())
            .unwrap_or(&[]);
        let n = import_table_rows(pool, "siem_settings", rows, true).await?;
        counts.insert("siem_settings".to_string(), n);
        return Ok(counts);
    }

    let mut delete_order: Vec<&str> = section.postgres_import_order().to_vec();
    delete_order.reverse();
    for table in delete_order {
        delete_table(pool, table).await?;
    }

    for table in section.postgres_import_order() {
        let rows = tables
            .get(*table)
            .and_then(|v| v.as_array())
            .map(|a| a.as_slice())
            .unwrap_or(&[]);
        let n = import_table_rows(pool, table, rows, false).await?;
        counts.insert((*table).to_string(), n);
    }
    Ok(counts)
}

pub fn redact_section_rows(section: BackupSection, payload: &mut Value) {
    let Some(tables) = payload.as_object_mut() else {
        return;
    };

    if section == BackupSection::Config {
        if let Some(settings) = tables.get_mut("siem_settings").and_then(|v| v.as_array_mut()) {
            for row in settings {
                redact_settings_row(row);
            }
        }
    }

    if section == BackupSection::Auth {
        if let Some(users) = tables.get_mut("users").and_then(|v| v.as_array_mut()) {
            for row in users {
                redact_user_row(row);
            }
        }
        if let Some(keys) = tables.get_mut("api_keys").and_then(|v| v.as_array_mut()) {
            for row in keys {
                redact_api_key_row(row);
            }
        }
    }
}

fn redact_settings_row(row: &mut Value) {
    let Some(obj) = row.as_object_mut() else {
        return;
    };
    let Some(key) = obj.get("key").and_then(|v| v.as_str()) else {
        return;
    };
    if key != "llm_config" && key != "mcp_config" {
        return;
    }
    if let Some(value) = obj.get_mut("value").and_then(|v| v.as_object_mut()) {
        if value.contains_key("api_key") {
            value.insert("api_key".into(), json!("__REDACTED__"));
        }
    }
}

fn redact_user_row(row: &mut Value) {
    let Some(obj) = row.as_object_mut() else {
        return;
    };
    obj.insert("password_hash".into(), json!("__REDACTED__"));
    if obj.contains_key("totp_secret") {
        obj.insert("totp_secret".into(), Value::Null);
    }
}

fn redact_api_key_row(row: &mut Value) {
    let Some(obj) = row.as_object_mut() else {
        return;
    };
    obj.insert("key_hash".into(), json!("__REDACTED__"));
    if obj.contains_key("key_ciphertext") {
        obj.insert("key_ciphertext".into(), Value::Null);
    }
}
