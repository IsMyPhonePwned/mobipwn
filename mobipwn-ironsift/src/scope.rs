use mobipwn_core::config::AppConfig;
use mobipwn_core::store::CaseRepository;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::extract::{list_device_ids_for_filter, ScopeFilter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IronSiftScopeOptions {
    pub cases: Vec<ScopeCaseOption>,
    pub tags: Vec<String>,
    pub sources: Vec<ScopeSourceOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeCaseOption {
    pub id: Uuid,
    pub title: String,
    pub ingest_source: Option<String>,
    pub tags: Vec<String>,
    pub device_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeSourceOption {
    pub source: String,
    pub device_ids: Vec<String>,
    pub case_id: Option<Uuid>,
    pub tags: Vec<String>,
}

/// Resolve case id and tag filters into concrete ClickHouse source / device constraints.
pub async fn resolve_scope(
    cases: &CaseRepository,
    filter: &mut ScopeFilter,
) -> anyhow::Result<()> {
    if filter
        .source
        .as_deref()
        .filter(|s| !s.is_empty())
        .is_none()
    {
        if let Some(case_id) = filter.case_id {
            if let Some(case) = cases.get(case_id).await? {
                if let Some(src) = case
                    .ingest_source
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    filter.source = Some(src.to_string());
                }
            }
        }
    }

    let mut tag_list: Vec<String> = Vec::new();
    if let Some(ref baseline) = filter.baseline_tags {
        for t in baseline {
            let t = t.trim();
            if !t.is_empty() && !tag_list.iter().any(|x| x == t) {
                tag_list.push(t.to_string());
            }
        }
    }
    if let Some(ref candidate) = filter.candidate_tags {
        for t in candidate {
            let t = t.trim();
            if !t.is_empty() && !tag_list.iter().any(|x| x == t) {
                tag_list.push(t.to_string());
            }
        }
    }
    if !tag_list.is_empty() {
        let from_tags = cases.find_ingest_sources_by_tags(&tag_list).await?;
        merge_sources(filter, from_tags);
    }

    Ok(())
}

fn merge_sources(filter: &mut ScopeFilter, from_tags: Vec<String>) {
    if from_tags.is_empty() {
        return;
    }
    if let Some(ref mut sources) = filter.sources {
        for s in from_tags {
            if !sources.iter().any(|x| x == &s) {
                sources.push(s);
            }
        }
        return;
    }
    if let Some(ref single) = filter.source {
        let mut merged = vec![single.clone()];
        for s in from_tags {
            if !merged.iter().any(|x| x == &s) {
                merged.push(s);
            }
        }
        if merged.len() > 1 {
            filter.sources = Some(merged);
            filter.source = None;
        }
        return;
    }
    if from_tags.len() == 1 {
        filter.source = Some(from_tags[0].clone());
    } else {
        filter.sources = Some(from_tags);
    }
}

pub async fn fetch_scope_options(
    config: &AppConfig,
    cases: &CaseRepository,
) -> anyhow::Result<IronSiftScopeOptions> {
    let mut tags = cases.list_distinct_tags().await?;
    let endpoint_cases = cases.list_endpoint_cases().await?;
    let mut case_options = Vec::with_capacity(endpoint_cases.len());
    let mut sources_map: std::collections::HashMap<String, ScopeSourceOption> =
        std::collections::HashMap::new();

    for case in endpoint_cases {
        let source = case.ingest_source.clone().unwrap_or_default();
        let device_ids = if source.is_empty() {
            Vec::new()
        } else {
            let mut f = ScopeFilter::endpoint_defaults();
            f.source = Some(source.clone());
            list_device_ids_for_filter(config, &f).await.unwrap_or_default()
        };
        case_options.push(ScopeCaseOption {
            id: case.id,
            title: case.title,
            ingest_source: case.ingest_source.clone(),
            tags: case.tags.clone(),
            device_ids: device_ids.clone(),
        });
        if !source.is_empty() {
            sources_map
                .entry(source.clone())
                .or_insert_with(|| ScopeSourceOption {
                    source: source.clone(),
                    device_ids: device_ids.clone(),
                    case_id: Some(case.id),
                    tags: case.tags.clone(),
                });
        }
    }

    let mut sources: Vec<ScopeSourceOption> = sources_map.into_values().collect();
    sources.sort_by(|a, b| a.source.cmp(&b.source));
    tags.sort();

    Ok(IronSiftScopeOptions {
        cases: case_options,
        tags,
        sources,
    })
}
