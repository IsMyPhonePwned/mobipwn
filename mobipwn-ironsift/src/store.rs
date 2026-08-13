use chrono::{DateTime, Utc};
use mobipwn_core::config::AppConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::extract::ScopeFilter;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ironsift_run_mode", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IronSiftRunMode {
    Fleet,
    Temporal,
    File,
    Both,
    Anomark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ironsift_run_scope", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IronSiftRunScope {
    Fleet,
    Case,
    Device,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ironsift_run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IronSiftRunStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ironsift_triage_verdict", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IronSiftTriageVerdict {
    Unset,
    #[serde(rename = "false_positive")]
    FalsePositive,
    Malicious,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftRunRecord {
    pub id: Uuid,
    pub mode: IronSiftRunMode,
    pub scope: IronSiftRunScope,
    pub scope_filter: Value,
    pub config_json: Value,
    pub status: IronSiftRunStatus,
    pub fleet_size: i32,
    pub anomaly_count: i32,
    pub summary: String,
    pub error: Option<String>,
    pub report_json: Option<Value>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub triggered_by: String,
    pub ironsift_config_name: Option<String>,
    pub anomark_config_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftFindingRecord {
    pub id: Uuid,
    pub run_id: Uuid,
    pub machine_id: String,
    pub detector: String,
    pub severity: String,
    pub score: f64,
    pub distance_score: Option<f64>,
    pub reasons: Vec<String>,
    pub cluster_id: Option<String>,
    pub alert_id: Option<Uuid>,
    pub raw_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveFindingInput {
    pub machine_id: String,
    pub detector: String,
    pub severity: String,
    pub score: f64,
    pub distance_score: Option<f64>,
    pub reasons: Vec<String>,
    pub cluster_id: Option<String>,
    pub raw_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveTriageInput {
    pub finding_id: Uuid,
    pub detector: String,
    pub reason: String,
    pub verdict: IronSiftTriageVerdict,
    pub actor_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoneycombCell {
    pub machine_id: String,
    pub severity: String,
    pub score: f64,
    pub row: i32,
    pub col: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftDashboardStats {
    pub source_count: i64,
    pub run_count: i64,
    pub latest_findings_count: i64,
    pub anomark_train_count: i64,
    pub latest_run: Option<IronSiftRunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftTriageRecord {
    pub run_id: Uuid,
    pub finding_id: Uuid,
    pub detector: String,
    pub reason: String,
    pub verdict: IronSiftTriageVerdict,
    pub alert_id: Option<Uuid>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriageMemoryEntry {
    pub detector: String,
    pub reason: String,
    pub verdict: IronSiftTriageVerdict,
    pub run_id: Uuid,
    pub updated_at: DateTime<Utc>,
}

pub struct IronSiftRepository {
    pool: PgPool,
}

impl IronSiftRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn create_run(
        &self,
        mode: IronSiftRunMode,
        scope: IronSiftRunScope,
        filter: &ScopeFilter,
        config_json: &Value,
        triggered_by: &str,
        ironsift_config_name: Option<&str>,
        anomark_config_name: Option<&str>,
    ) -> anyhow::Result<IronSiftRunRecord> {
        let scope_filter = serde_json::to_value(filter)?;
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO ironsift_runs \
             (mode, scope, scope_filter, config_json, triggered_by, status, ironsift_config_name, anomark_config_name) \
             VALUES ($1, $2, $3, $4, $5, 'running', $6, $7) RETURNING id",
        )
        .bind(mode)
        .bind(scope)
        .bind(scope_filter)
        .bind(config_json)
        .bind(triggered_by)
        .bind(ironsift_config_name)
        .bind(anomark_config_name)
        .fetch_one(&self.pool)
        .await?;
        self.get_run(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("run missing after insert"))
    }

    pub async fn finish_run(
        &self,
        id: Uuid,
        status: IronSiftRunStatus,
        fleet_size: i32,
        anomaly_count: i32,
        summary: &str,
        error: Option<&str>,
        report_json: Option<&Value>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE ironsift_runs SET status = $2, fleet_size = $3, anomaly_count = $4, \
             summary = $5, error = $6, report_json = $7, finished_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(fleet_size)
        .bind(anomaly_count)
        .bind(summary)
        .bind(error)
        .bind(report_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_run(&self, id: Uuid) -> anyhow::Result<Option<IronSiftRunRecord>> {
        let row = sqlx::query_as::<_, RunRow>(
            "SELECT id, mode, scope, scope_filter, config_json, status, fleet_size, anomaly_count, \
             summary, error, report_json, started_at, finished_at, triggered_by, \
             ironsift_config_name, anomark_config_name \
             FROM ironsift_runs WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn list_runs(&self, limit: i64) -> anyhow::Result<Vec<IronSiftRunRecord>> {
        let rows = sqlx::query_as::<_, RunRow>(
            "SELECT id, mode, scope, scope_filter, config_json, status, fleet_size, anomaly_count, \
             summary, error, report_json, started_at, finished_at, triggered_by, \
             ironsift_config_name, anomark_config_name \
             FROM ironsift_runs ORDER BY started_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn save_findings(
        &self,
        run_id: Uuid,
        findings: &[SaveFindingInput],
    ) -> anyhow::Result<Vec<IronSiftFindingRecord>> {
        let mut out = Vec::with_capacity(findings.len());
        for f in findings {
            let row = sqlx::query_as::<_, FindingRow>(
                "INSERT INTO ironsift_findings \
                 (run_id, machine_id, detector, severity, score, distance_score, reasons, cluster_id, raw_json) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 RETURNING id, run_id, machine_id, detector, severity, score, distance_score, \
                 reasons, cluster_id, alert_id, raw_json, created_at",
            )
            .bind(run_id)
            .bind(&f.machine_id)
            .bind(&f.detector)
            .bind(&f.severity)
            .bind(f.score)
            .bind(f.distance_score)
            .bind(&f.reasons)
            .bind(&f.cluster_id)
            .bind(&f.raw_json)
            .fetch_one(&self.pool)
            .await?;
            out.push(row.into());
        }
        Ok(out)
    }

    pub async fn get_finding(
        &self,
        run_id: Uuid,
        finding_id: Uuid,
    ) -> anyhow::Result<Option<IronSiftFindingRecord>> {
        let row = sqlx::query_as::<_, FindingRow>(
            "SELECT id, run_id, machine_id, detector, severity, score, distance_score, \
             reasons, cluster_id, alert_id, raw_json, created_at \
             FROM ironsift_findings WHERE run_id = $1 AND id = $2",
        )
        .bind(run_id)
        .bind(finding_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn list_findings(&self, run_id: Uuid) -> anyhow::Result<Vec<IronSiftFindingRecord>> {
        let rows = sqlx::query_as::<_, FindingRow>(
            "SELECT id, run_id, machine_id, detector, severity, score, distance_score, \
             reasons, cluster_id, alert_id, raw_json, created_at \
             FROM ironsift_findings WHERE run_id = $1 ORDER BY score DESC, machine_id",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn set_finding_alert_id(
        &self,
        finding_id: Uuid,
        alert_id: Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE ironsift_findings SET alert_id = $2 WHERE id = $1")
            .bind(finding_id)
            .bind(alert_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn record_devices(
        &self,
        run_id: Uuid,
        machine_ids: &[String],
        source: Option<&str>,
    ) -> anyhow::Result<()> {
        for mid in machine_ids {
            sqlx::query(
                "INSERT INTO ironsift_run_devices (run_id, machine_id, device_id, source) \
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            )
            .bind(run_id)
            .bind(mid)
            .bind(mid)
            .bind(source)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn save_triage(&self, run_id: Uuid, entries: &[SaveTriageInput]) -> anyhow::Result<()> {
        for e in entries {
            sqlx::query(
                "INSERT INTO ironsift_triage (run_id, finding_id, detector, reason, verdict, actor_id, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, now()) \
                 ON CONFLICT (run_id, finding_id, detector, reason) DO UPDATE SET \
                   verdict = EXCLUDED.verdict, actor_id = EXCLUDED.actor_id, updated_at = now()",
            )
            .bind(run_id)
            .bind(e.finding_id)
            .bind(&e.detector)
            .bind(&e.reason)
            .bind(e.verdict)
            .bind(e.actor_id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn list_triage_for_run(&self, run_id: Uuid) -> anyhow::Result<Vec<IronSiftTriageRecord>> {
        let rows = sqlx::query_as::<_, TriageRow>(
            "SELECT run_id, finding_id, detector, reason, verdict, alert_id, updated_at \
             FROM ironsift_triage WHERE run_id = $1 ORDER BY updated_at DESC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn get_triage_alert_id(
        &self,
        run_id: Uuid,
        finding_id: Uuid,
        detector: &str,
        reason: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        let alert_id = sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT alert_id FROM ironsift_triage \
             WHERE run_id = $1 AND finding_id = $2 AND detector = $3 AND reason = $4",
        )
        .bind(run_id)
        .bind(finding_id)
        .bind(detector)
        .bind(reason)
        .fetch_optional(&self.pool)
        .await?;
        Ok(alert_id.flatten())
    }

    pub async fn set_triage_alert_id(
        &self,
        run_id: Uuid,
        finding_id: Uuid,
        detector: &str,
        reason: &str,
        alert_id: Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO ironsift_triage (run_id, finding_id, detector, reason, verdict, alert_id, updated_at) \
             VALUES ($1, $2, $3, $4, 'unset', $5, now()) \
             ON CONFLICT (run_id, finding_id, detector, reason) DO UPDATE SET \
               alert_id = EXCLUDED.alert_id, updated_at = now()",
        )
        .bind(run_id)
        .bind(finding_id)
        .bind(detector)
        .bind(reason)
        .bind(alert_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_triage_memory(&self) -> anyhow::Result<Vec<TriageMemoryEntry>> {
        let rows = sqlx::query_as::<_, TriageMemoryRow>(
            "SELECT DISTINCT ON (detector, reason) detector, reason, verdict, run_id, updated_at \
             FROM ironsift_triage WHERE verdict != 'unset' \
             ORDER BY detector, reason, updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn delete_triage_memory(&self, detector: &str, reason: &str) -> anyhow::Result<u64> {
        let r = sqlx::query("DELETE FROM ironsift_triage WHERE detector = $1 AND reason = $2")
            .bind(detector)
            .bind(reason)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    pub async fn dashboard_stats(&self, source_count: i64) -> anyhow::Result<IronSiftDashboardStats> {
        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM ironsift_runs")
            .fetch_one(&self.pool)
            .await?;
        let anomark_train_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::bigint FROM ironsift_anomark_trains")
                .fetch_one(&self.pool)
                .await?;
        let latest_run = self.list_runs(1).await?.into_iter().next();
        let latest_findings_count = if let Some(ref run) = latest_run {
            run.anomaly_count as i64
        } else {
            0
        };
        Ok(IronSiftDashboardStats {
            source_count,
            run_count,
            latest_findings_count,
            anomark_train_count,
            latest_run,
        })
    }

    pub async fn delete_run(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM ironsift_runs WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn delete_all_runs(&self) -> anyhow::Result<u64> {
        let r = sqlx::query("DELETE FROM ironsift_runs")
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }

    fn honeycomb_severity_rank(severity: &str) -> i32 {
        match severity.to_ascii_uppercase().as_str() {
            "CRITICAL" => 4,
            "HIGH" => 3,
            "MEDIUM" => 2,
            "LOW" => 1,
            _ => 0,
        }
    }

    pub async fn honeycomb(
        &self,
        run_id: Uuid,
        min_score: f64,
        severity_filter: Option<&str>,
    ) -> anyhow::Result<Vec<HoneycombCell>> {
        let findings = self.list_findings(run_id).await?;
        let mut best_by_machine: std::collections::HashMap<String, HoneycombCell> =
            std::collections::HashMap::new();
        for f in findings.into_iter().filter(|f| f.score >= min_score).filter(|f| {
            severity_filter
                .map(|s| f.severity.eq_ignore_ascii_case(s))
                .unwrap_or(true)
        }) {
            let rank = Self::honeycomb_severity_rank(&f.severity);
            let replace = match best_by_machine.get(&f.machine_id) {
                None => true,
                Some(cur) => {
                    let cur_rank = Self::honeycomb_severity_rank(&cur.severity);
                    rank > cur_rank || (rank == cur_rank && f.score > cur.score)
                }
            };
            if replace {
                best_by_machine.insert(
                    f.machine_id.clone(),
                    HoneycombCell {
                        machine_id: f.machine_id,
                        severity: f.severity,
                        score: f.score,
                        row: 0,
                        col: 0,
                    },
                );
            }
        }
        let mut cells: Vec<HoneycombCell> = best_by_machine.into_values().collect();
        cells.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let cols = 8_i32;
        for (idx, cell) in cells.iter_mut().enumerate() {
            cell.row = (idx as i32) / cols;
            cell.col = (idx as i32) % cols;
        }
        Ok(cells)
    }

    pub async fn delete_by_source(&self, source: &str) -> anyhow::Result<u64> {
        let source = source.trim();
        if source.is_empty() {
            return Ok(0);
        }
        let run_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT DISTINCT run_id FROM ironsift_run_devices WHERE source = $1",
        )
        .bind(source)
        .fetch_all(&self.pool)
        .await?;
        if !run_ids.is_empty() {
            sqlx::query("DELETE FROM ironsift_runs WHERE id = ANY($1)")
                .bind(&run_ids)
                .execute(&self.pool)
                .await?;
        }
        let r = sqlx::query(
            "DELETE FROM ironsift_runs WHERE scope_filter->>'source' = $1 \
             OR scope_filter @> jsonb_build_object('source', to_jsonb($1::text))",
        )
        .bind(source)
        .execute(&self.pool)
        .await?;
        Ok(r.rows_affected().saturating_add(run_ids.len() as u64))
    }

    pub async fn insert_anomark_train(
        &self,
        id: Uuid,
        label: &str,
        scope_filter: &Value,
        request_json: &Value,
        training_line_count: i64,
        rel_model_path: &str,
        rel_training_path: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO ironsift_anomark_trains \
             (id, label, scope_filter, request_json, training_line_count, rel_model_path, rel_training_path) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(id)
        .bind(label)
        .bind(scope_filter)
        .bind(request_json)
        .bind(training_line_count)
        .bind(rel_model_path)
        .bind(rel_training_path)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_anomark_trains(&self) -> anyhow::Result<Vec<crate::anomark::AnoMarkTrainRecord>> {
        let rows = sqlx::query_as::<_, AnoMarkTrainRow>(
            "SELECT id, label, scope_filter, request_json, training_line_count, rel_model_path, \
             rel_training_path, created_at, favorite \
             FROM ironsift_anomark_trains ORDER BY favorite DESC, created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn get_anomark_train(&self, id: Uuid) -> anyhow::Result<Option<crate::anomark::AnoMarkTrainRecord>> {
        let row = sqlx::query_as::<_, AnoMarkTrainRow>(
            "SELECT id, label, scope_filter, request_json, training_line_count, rel_model_path, \
             rel_training_path, created_at, favorite \
             FROM ironsift_anomark_trains WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn delete_anomark_train(&self, id: Uuid) -> anyhow::Result<bool> {
        let r = sqlx::query("DELETE FROM ironsift_anomark_trains WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn delete_all_anomark_trains(&self) -> anyhow::Result<i64> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::bigint FROM ironsift_anomark_trains")
                .fetch_one(&self.pool)
                .await?;
        sqlx::query("DELETE FROM ironsift_anomark_trains")
            .execute(&self.pool)
            .await?;
        Ok(count)
    }
}

#[derive(sqlx::FromRow)]
struct RunRow {
    id: Uuid,
    mode: IronSiftRunMode,
    scope: IronSiftRunScope,
    scope_filter: Value,
    config_json: Value,
    status: IronSiftRunStatus,
    fleet_size: i32,
    anomaly_count: i32,
    summary: String,
    error: Option<String>,
    report_json: Option<Value>,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    triggered_by: String,
    ironsift_config_name: Option<String>,
    anomark_config_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TriageRow {
    run_id: Uuid,
    finding_id: Uuid,
    detector: String,
    reason: String,
    verdict: IronSiftTriageVerdict,
    alert_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
}

impl From<TriageRow> for IronSiftTriageRecord {
    fn from(r: TriageRow) -> Self {
        Self {
            run_id: r.run_id,
            finding_id: r.finding_id,
            detector: r.detector,
            reason: r.reason,
            verdict: r.verdict,
            alert_id: r.alert_id,
            updated_at: r.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct TriageMemoryRow {
    detector: String,
    reason: String,
    verdict: IronSiftTriageVerdict,
    run_id: Uuid,
    updated_at: DateTime<Utc>,
}

impl From<TriageMemoryRow> for TriageMemoryEntry {
    fn from(r: TriageMemoryRow) -> Self {
        Self {
            detector: r.detector,
            reason: r.reason,
            verdict: r.verdict,
            run_id: r.run_id,
            updated_at: r.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct FindingRow {
    id: Uuid,
    run_id: Uuid,
    machine_id: String,
    detector: String,
    severity: String,
    score: f64,
    distance_score: Option<f64>,
    reasons: Vec<String>,
    cluster_id: Option<String>,
    alert_id: Option<Uuid>,
    raw_json: Value,
    created_at: DateTime<Utc>,
}

impl From<RunRow> for IronSiftRunRecord {
    fn from(r: RunRow) -> Self {
        Self {
            id: r.id,
            mode: r.mode,
            scope: r.scope,
            scope_filter: r.scope_filter,
            config_json: r.config_json,
            status: r.status,
            fleet_size: r.fleet_size,
            anomaly_count: r.anomaly_count,
            summary: r.summary,
            error: r.error,
            report_json: r.report_json,
            started_at: r.started_at,
            finished_at: r.finished_at,
            triggered_by: r.triggered_by,
            ironsift_config_name: r.ironsift_config_name,
            anomark_config_name: r.anomark_config_name,
        }
    }
}

impl From<FindingRow> for IronSiftFindingRecord {
    fn from(r: FindingRow) -> Self {
        Self {
            id: r.id,
            run_id: r.run_id,
            machine_id: r.machine_id,
            detector: r.detector,
            severity: r.severity,
            score: r.score,
            distance_score: r.distance_score,
            reasons: r.reasons,
            cluster_id: r.cluster_id,
            alert_id: r.alert_id,
            raw_json: r.raw_json,
            created_at: r.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct AnoMarkTrainRow {
    id: Uuid,
    label: String,
    scope_filter: Value,
    request_json: Value,
    training_line_count: i64,
    rel_model_path: String,
    rel_training_path: String,
    created_at: DateTime<Utc>,
    favorite: bool,
}

impl From<AnoMarkTrainRow> for crate::anomark::AnoMarkTrainRecord {
    fn from(r: AnoMarkTrainRow) -> Self {
        Self {
            id: r.id,
            label: r.label,
            scope_filter: r.scope_filter,
            request_json: r.request_json,
            training_line_count: r.training_line_count,
            rel_model_path: r.rel_model_path,
            rel_training_path: r.rel_training_path,
            created_at: r.created_at,
            favorite: r.favorite,
        }
    }
}

#[allow(dead_code)]
pub fn ch_client(config: &AppConfig) -> clickhouse::Client {
    config.clickhouse_client()
}
