use mobipwn_core::alerts::{dedup_key, AlertContext};
use mobipwn_core::mudm::ENDPOINT;
use mobipwn_core::AlertRepository;
use uuid::Uuid;

use crate::constants::{IRONSIFT_FILE_RULE_ID, IRONSIFT_FLEET_RULE_ID, IRONSIFT_TEMPORAL_RULE_ID};
use crate::store::{IronSiftFindingRecord, IronSiftRepository, IronSiftRunMode, SaveFindingInput};

async fn create_ironsift_alert(
    alerts: &AlertRepository,
    run_id: Uuid,
    mode: IronSiftRunMode,
    finding: &IronSiftFindingRecord,
    title: &str,
    reasons: &[String],
    reason_facet: Option<&str>,
) -> anyhow::Result<uuid::Uuid> {
    let rule_id = rule_id_for_mode(mode);
    let mut facets = vec![
        ("device_id", finding.machine_id.as_str()),
        ("detector", finding.detector.as_str()),
    ];
    if let Some(reason) = reason_facet {
        facets.push(("reason", reason));
    }
    let ctx = AlertContext {
        platform: Some(ENDPOINT.to_string()),
        device_id: Some(finding.machine_id.clone()),
        ironsift_run_id: Some(run_id.to_string()),
        ironsift_detector: Some(finding.detector.clone()),
        ironsift_reasons: Some(reasons.to_vec()),
        ironsift_score: Some(finding.score),
        ..Default::default()
    };
    let alert = alerts
        .upsert_from_detection(
            rule_id,
            &format!("ironsift-{}", finding.detector),
            &finding.severity.to_lowercase(),
            title,
            &facets,
            None,
            &ctx,
            None,
        )
        .await?;
    Ok(alert.id)
}

async fn upsert_alert_for_finding(
    alerts: &AlertRepository,
    repo: &IronSiftRepository,
    run_id: Uuid,
    mode: IronSiftRunMode,
    finding: &IronSiftFindingRecord,
) -> anyhow::Result<IronSiftFindingRecord> {
    if finding.alert_id.is_some() {
        return Ok(finding.clone());
    }
    let title = finding
        .reasons
        .first()
        .cloned()
        .unwrap_or_else(|| format!("IronSift anomaly on {}", finding.machine_id));
    let alert_id = create_ironsift_alert(
        alerts,
        run_id,
        mode,
        finding,
        &title,
        &finding.reasons,
        None,
    )
    .await?;
    repo.set_finding_alert_id(finding.id, alert_id).await?;
    let mut updated = finding.clone();
    updated.alert_id = Some(alert_id);
    Ok(updated)
}

async fn upsert_alert_for_reason(
    alerts: &AlertRepository,
    repo: &IronSiftRepository,
    run_id: Uuid,
    mode: IronSiftRunMode,
    finding: &IronSiftFindingRecord,
    reason: &str,
) -> anyhow::Result<IronSiftFindingRecord> {
    if let Some(alert_id) = repo
        .get_triage_alert_id(run_id, finding.id, &finding.detector, reason)
        .await?
    {
        let mut updated = finding.clone();
        if updated.alert_id.is_none() {
            updated.alert_id = Some(alert_id);
        }
        return Ok(updated);
    }
    let alert_id = create_ironsift_alert(
        alerts,
        run_id,
        mode,
        finding,
        reason,
        &[reason.to_string()],
        Some(reason),
    )
    .await?;
    repo.set_triage_alert_id(run_id, finding.id, &finding.detector, reason, alert_id)
        .await?;
    Ok(finding.clone())
}

pub async fn sync_findings_to_alerts(
    alerts: &AlertRepository,
    repo: &IronSiftRepository,
    run_id: Uuid,
    mode: IronSiftRunMode,
    findings: &[SaveFindingInput],
    min_score: f64,
    create_alerts: bool,
) -> anyhow::Result<Vec<IronSiftFindingRecord>> {
    let saved = repo.save_findings(run_id, findings).await?;
    if !create_alerts {
        return Ok(saved);
    }
    let mut out = Vec::with_capacity(saved.len());
    for finding in &saved {
        if finding.score < min_score {
            out.push(finding.clone());
            continue;
        }
        out.push(
            upsert_alert_for_finding(alerts, repo, run_id, mode, finding)
                .await?,
        );
    }
    Ok(out)
}

pub async fn promote_finding_to_alert(
    alerts: &AlertRepository,
    repo: &IronSiftRepository,
    run_id: Uuid,
    finding_id: Uuid,
    reason: Option<&str>,
) -> anyhow::Result<IronSiftFindingRecord> {
    let run = repo
        .get_run(run_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("run not found"))?;
    let finding = repo
        .get_finding(run_id, finding_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("finding not found"))?;
    if let Some(reason) = reason {
        if !finding.reasons.iter().any(|r| r == reason) {
            anyhow::bail!("reason not found on finding");
        }
        return upsert_alert_for_reason(alerts, repo, run_id, run.mode, &finding, reason).await;
    }
    upsert_alert_for_finding(alerts, repo, run_id, run.mode, &finding).await
}

fn rule_id_for_mode(mode: IronSiftRunMode) -> Uuid {
    match mode {
        IronSiftRunMode::Fleet | IronSiftRunMode::Both | IronSiftRunMode::Anomark => {
            IRONSIFT_FLEET_RULE_ID
        }
        IronSiftRunMode::Temporal => IRONSIFT_TEMPORAL_RULE_ID,
        IronSiftRunMode::File => IRONSIFT_FILE_RULE_ID,
    }
}

#[allow(dead_code)]
pub fn finding_dedup_key(rule_id: &Uuid, machine_id: &str, detector: &str, reason: &str) -> String {
    dedup_key(
        &rule_id.to_string(),
        &[
            ("device_id", machine_id),
            ("detector", detector),
            ("reason", reason),
        ],
    )
}
