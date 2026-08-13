use crate::case_audit::{emit_case_audit, CaseAuditAction, CaseAuditActor, CaseAuditExtras};
use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::data::{fetch_data_summary, SourceSummary};
use crate::db::{DualPool, PoolHealth};
use crate::mudm::{androidboot_em_model, parse_android_build_fingerprint};
use crate::store::{CaseRecord, CaseRepository, IngestJobRepository};
use std::collections::HashMap;
use std::sync::Arc;

/// ClickHouse rows that should not become investigation cases when listing.
fn is_registerable_ingest_source(src: &SourceSummary) -> bool {
    if src.source.trim().is_empty() {
        return false;
    }
    // Case audit timeline events use source="case" + source_type="audit" (see case_audit::emit).
    src.source_type != "audit"
}

/// List Postgres cases and attach ClickHouse event counts; auto-register ingest sources.
pub async fn list_cases_with_ingest(
    pool: &Arc<DualPool>,
    config: &AppConfig,
    repo: &CaseRepository,
    ingest_jobs: &IngestJobRepository,
    clickhouse: Option<&clickhouse::Client>,
    status: Option<&str>,
    q: Option<&str>,
    owner: Option<&str>,
) -> anyhow::Result<Vec<CaseRecord>> {
    let mut cases = repo.list(status, q, owner).await?;
    let owner_filter = owner.map(str::trim).filter(|s| !s.is_empty());
    if pool.health().await != PoolHealth::Full {
        return Ok(cases);
    }

    let summary = match fetch_data_summary(pool, config, &[]).await {
        Ok(s) => s,
        Err(_) => return Ok(cases),
    };

    let query = q.unwrap_or("").trim().to_lowercase();
    let filter_by_query = !query.is_empty();

    for src in &summary.sources {
        if !is_registerable_ingest_source(src) {
            continue;
        }
        if owner_filter.is_some() {
            continue;
        }
        if filter_by_query {
            let hay = format!("{} {} {}", src.source, src.platform, src.source_type).to_lowercase();
            if !hay.contains(&query) {
                continue;
            }
        }

        let has_case = cases.iter().any(|c| {
            c.title == src.source
                || c.ingest_source.as_deref() == Some(src.source.as_str())
        });
        if !has_case {
            if repo.is_ingest_source_tombstoned(&src.source).await? {
                continue;
            }
            if let Ok((c, is_new)) = repo
                .ensure_for_ingest_source(&src.source, &src.platform, None)
                .await
            {
                if is_new {
                    if let Some(ch) = clickhouse {
                        let _ = emit_case_audit(
                            ch,
                            &c,
                            CaseAuditAction::Created,
                            &CaseAuditActor::system(),
                            CaseAuditExtras {
                                grouping_type: Some("ingest".into()),
                                ..Default::default()
                            },
                        )
                        .await;
                    }
                }
                cases.push(c);
            }
        }
    }

    for case in &mut cases {
        let key = case.ingest_source.as_deref().unwrap_or(case.title.as_str());
        if let Some(src) = summary.sources.iter().find(|s| s.source == key) {
            case.event_count = Some(src.event_count);
            case.first_ingest_at = src.first_ingest.clone();
            case.last_ingest_at = src.last_ingest.clone();
        }
    }

    if pool.health().await == PoolHealth::Full {
        let source_keys: Vec<String> = cases
            .iter()
            .map(|c| {
                c.ingest_source
                    .clone()
                    .unwrap_or_else(|| c.title.clone())
            })
            .collect();
        if let Ok(counts) = ingest_jobs.count_done_by_sources(&source_keys).await {
            for case in &mut cases {
                let key = case
                    .ingest_source
                    .as_deref()
                    .unwrap_or(case.title.as_str());
                if let Some(n) = counts.get(key) {
                    case.ingest_run_count = Some(*n as u32);
                }
            }
        }
    }

    if pool.health().await == PoolHealth::Full {
        enrich_device_snapshots(config, &mut cases).await;
    }

    if let Some(o) = owner_filter {
        cases.retain(|c| c.user == o);
    }

    cases.sort_by(|a, b| {
        let ta = case_activity_ms(a);
        let tb = case_activity_ms(b);
        tb.cmp(&ta).then_with(|| a.title.cmp(&b.title))
    });
    Ok(cases)
}

fn case_activity_ms(case: &CaseRecord) -> i64 {
    [&case.last_ingest_at, &case.first_ingest_at]
        .into_iter()
        .flatten()
        .find_map(|s| parse_activity_timestamp(s))
        .unwrap_or_else(|| case.updated_at.timestamp_millis())
}

fn parse_activity_timestamp(raw: &str) -> Option<i64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(t) {
        return Some(dt.timestamp_millis());
    }
    // ClickHouse-style / legacy naive UTC: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
    let normalized = if t.len() >= 19 && (t.as_bytes()[10] == b' ' || t.as_bytes()[10] == b'T') {
        format!("{}T{}Z", &t[..10], &t[11..19])
    } else {
        return None;
    };
    chrono::DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn escape_clickhouse_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

fn case_source_key(case: &CaseRecord) -> String {
    case.ingest_source
        .clone()
        .unwrap_or_else(|| case.title.clone())
}

/// Attach the most common device_model / os_version per ingest source from ClickHouse.
///
/// `os_version` on events is often polluted with app/library versions, so model and OS
/// are picked independently: any non-empty `device_model`, and only OS-looking `os_version`.
async fn enrich_device_snapshots(config: &AppConfig, cases: &mut [CaseRecord]) {
    let mut sources: Vec<String> = cases
        .iter()
        .map(case_source_key)
        .filter(|s| !s.trim().is_empty())
        .collect();
    if sources.is_empty() {
        return;
    }
    sources.sort();
    sources.dedup();

    let in_list = sources
        .iter()
        .map(|s| format!("'{}'", escape_clickhouse_literal(s)))
        .collect::<Vec<_>>()
        .join(",");
    let db = &config.clickhouse_database;

    let model_sql = format!(
        "SELECT source, device_model, count() AS c \
         FROM {db}.events \
         WHERE source IN ({in_list}) AND device_model != '' \
         GROUP BY source, device_model \
         ORDER BY source, c DESC"
    );
    // Prefer explicit OS labels; allow bare Android major versions (e.g. "14").
    // Exclude app-style strings like "1.0 (1)" / "373.2 (373.2)".
    let os_sql = format!(
        "SELECT source, os_version, count() AS c \
         FROM {db}.events \
         WHERE source IN ({in_list}) \
           AND ( \
             startsWith(os_version, 'iPhone OS') \
             OR startsWith(lowerUTF8(os_version), 'ios ') \
             OR startsWith(lowerUTF8(os_version), 'android') \
             OR match(os_version, '^\\\\d{{1,2}}$') \
           ) \
         GROUP BY source, os_version \
         ORDER BY source, c DESC"
    );

    let models = query_json_each_row(config, db, &model_sql)
        .await
        .unwrap_or_default();
    let oss = query_json_each_row(config, db, &os_sql)
        .await
        .unwrap_or_default();

    let mut best_model: HashMap<String, String> = HashMap::new();
    for row in models {
        let Some(source) = row.get("source").and_then(|v| v.as_str()) else {
            continue;
        };
        if best_model.contains_key(source) {
            continue;
        }
        if let Some(model) = row
            .get("device_model")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            best_model.insert(source.to_string(), model.to_string());
        }
    }

    let mut best_os: HashMap<String, String> = HashMap::new();
    for row in oss {
        let Some(source) = row.get("source").and_then(|v| v.as_str()) else {
            continue;
        };
        if best_os.contains_key(source) {
            continue;
        }
        if let Some(os) = row
            .get("os_version")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            best_os.insert(source.to_string(), os.to_string());
        }
    }

    for case in cases.iter_mut() {
        let key = case_source_key(case);
        case.device_model = best_model.get(&key).cloned();
        case.os_version = best_os.get(&key).cloned();
    }

    // Android bugreports often leave device_model/os_version empty on columns; model lives in
    // Header `Build fingerprint` / cmdline. Fill gaps from those events without requiring re-ingest.
    let missing: Vec<String> = cases
        .iter()
        .filter(|c| c.device_model.is_none() || c.os_version.is_none())
        .map(case_source_key)
        .filter(|s| !s.trim().is_empty())
        .collect();
    if missing.is_empty() {
        return;
    }
    let mut missing = missing;
    missing.sort();
    missing.dedup();
    let missing_list = missing
        .iter()
        .map(|s| format!("'{}'", escape_clickhouse_literal(s)))
        .collect::<Vec<_>>()
        .join(",");
    let header_sql = format!(
        "SELECT \
            source, \
            JSONExtractString(ext, 'Build fingerprint') AS fingerprint, \
            JSONExtractString(ext, 'Command line') AS cmdline, \
            JSONExtractString(ext, 'Android SDK version') AS sdk \
         FROM {db}.events \
         WHERE source IN ({missing_list}) \
           AND parser = 'Header' \
           AND ( \
             JSONExtractString(ext, 'Build fingerprint') != '' \
             OR JSONExtractString(ext, 'Command line') != '' \
           )"
    );
    let Ok(headers) = query_json_each_row(config, db, &header_sql).await else {
        return;
    };
    let mut from_header: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for row in headers {
        let Some(source) = row.get("source").and_then(|v| v.as_str()) else {
            continue;
        };
        if from_header.contains_key(source) {
            continue;
        }
        let fingerprint = row
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let cmdline = row.get("cmdline").and_then(|v| v.as_str()).unwrap_or("");
        let sdk = row.get("sdk").and_then(|v| v.as_str()).unwrap_or("");
        let marketing = androidboot_em_model(cmdline);
        let fp = parse_android_build_fingerprint(fingerprint);
        let model = if !marketing.is_empty() {
            Some(marketing)
        } else {
            fp.as_ref()
                .map(|p| p.display_model())
                .filter(|s| !s.is_empty())
        };
        let os = fp
            .as_ref()
            .filter(|p| !p.release.is_empty())
            .map(|p| format!("Android {}", p.release))
            .or_else(|| {
                let s = sdk.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(format!("API {s}"))
                }
            });
        if model.is_some() || os.is_some() {
            from_header.insert(source.to_string(), (model, os));
        }
    }

    for case in cases.iter_mut() {
        let key = case_source_key(case);
        let Some((model, os)) = from_header.get(&key) else {
            continue;
        };
        if case.device_model.is_none() {
            case.device_model = model.clone();
        }
        if case.os_version.is_none() {
            case.os_version = os.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_timeline_source_is_not_a_case() {
        let src = SourceSummary {
            source: "case".into(),
            platform: "mobipwn".into(),
            source_type: "audit".into(),
            event_count: 2,
            first_seen: None,
            last_seen: None,
            first_ingest: None,
            last_ingest: None,
            case_user: None,
            parsers: vec![],
            ingest_options: None,
        };
        assert!(!is_registerable_ingest_source(&src));
    }

    #[test]
    fn ingest_source_still_registers() {
        let src = SourceSummary {
            source: "case-a3f91b2c".into(),
            platform: "android".into(),
            source_type: "bugreport".into(),
            event_count: 100,
            first_seen: None,
            last_seen: None,
            first_ingest: None,
            last_ingest: None,
            case_user: None,
            parsers: vec![],
            ingest_options: None,
        };
        assert!(is_registerable_ingest_source(&src));
    }
}
