use crate::ch::query_json_each_row;
use crate::config::AppConfig;
use crate::enrichment::ch::{escape_ch, exec_sql};
use crate::enrichment::options::SyncOptions;
use crate::enrichment::progress::SyncProgress;
use crate::enrichment::provider::{ProviderAdapter, SyncResult};
use crate::enrichment::sync_metrics::SyncStats;
use async_trait::async_trait;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";

#[derive(Debug, Clone, Copy, Default)]
pub struct GooglePlayAdapter;

#[derive(Debug, Clone)]
struct PlayListing {
    package_id: String,
    on_play_store: bool,
    play_store_url: String,
    app_title: String,
}

#[async_trait]
impl ProviderAdapter for GooglePlayAdapter {
    fn slug(&self) -> &'static str {
        "google_play"
    }

    fn config_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "max_packages": {
                    "type": "integer",
                    "default": 50,
                    "description": "Max distinct Android package names to check per sync"
                },
                "lookback_days": {
                    "type": "integer",
                    "default": 90,
                    "description": "Only consider bundle_id values seen in Android events within this window"
                },
                "request_delay_ms": {
                    "type": "integer",
                    "default": 500,
                    "description": "Delay between Play Store HTTP requests (ms)"
                },
                "user_agent": {
                    "type": "string",
                    "description": "Optional User-Agent header for Play Store requests (defaults to Chrome on Android)"
                },
                "recheck_not_listed": {
                    "type": "boolean",
                    "default": true,
                    "description": "Re-query packages previously marked not on Play Store (fixes stale false negatives)"
                }
            }
        })
    }

    fn covers_fields(&self) -> &'static [&'static str] {
        &["bundle_id"]
    }

    async fn sync(
        &self,
        config: &AppConfig,
        provider_cfg: &Value,
        progress: &SyncProgress,
        options: &SyncOptions,
    ) -> anyhow::Result<SyncResult> {
        let max_packages = provider_cfg
            .get("max_packages")
            .and_then(|v| v.as_u64())
            .unwrap_or(50)
            .clamp(1, 500) as u32;
        let lookback = provider_cfg
            .get("lookback_days")
            .and_then(|v| v.as_u64())
            .unwrap_or(config.events_ttl_days as u64)
            .clamp(1, config.events_ttl_days as u64) as u32;
        let delay_ms = provider_cfg
            .get("request_delay_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(500);
        let user_agent = provider_cfg
            .get("user_agent")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_USER_AGENT);
        let recheck_not_listed = provider_cfg
            .get("recheck_not_listed")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()?;

        let mode = if options.full_resync {
            "full"
        } else {
            "incremental"
        };
        let mut stats = SyncStats::with_mode(mode);

        let existing = if options.full_resync {
            HashSet::new()
        } else {
            progress.provider(
                "google_play",
                "collect",
                "Loading already enriched package names…",
            );
            let keys = existing_listed_package_ids(config, recheck_not_listed).await?;
            progress.provider(
                "google_play",
                "collect_done",
                format!("{} package(s) already listed (will skip)", keys.len()),
            );
            keys
        };

        progress.provider(
            "google_play",
            "collect",
            "Scanning Android events for distinct bundle_id values…",
        );
        let packages = distinct_android_packages(config, max_packages, lookback).await?;
        progress.provider(
            "google_play",
            "collect_done",
            format!("Found {} package name(s) to evaluate", packages.len()),
        );

        let mut jobs: Vec<String> = Vec::new();
        for package_id in packages {
            if !is_android_package(&package_id) {
                stats.skipped_invalid += 1;
                progress.request(
                    "google_play",
                    "bundle_id",
                    &package_id,
                    "skip",
                    format!("Skip invalid package name: {package_id}"),
                );
                continue;
            }
            if !options.full_resync && existing.contains(&package_id) {
                stats.skipped_already_enriched += 1;
                progress.request(
                    "google_play",
                    "bundle_id",
                    &package_id,
                    "skip",
                    format!("Already enriched: {package_id}"),
                );
                continue;
            }
            if jobs.iter().any(|p| p == &package_id) {
                stats.skipped_duplicate += 1;
                continue;
            }
            jobs.push(package_id);
        }

        stats.queued = jobs.len() as u32;
        progress.provider(
            "google_play",
            "plan",
            format!("Queued {} Google Play lookup(s)", jobs.len()),
        );

        let mut written = 0usize;
        let total = jobs.len();
        for (idx, package_id) in jobs.iter().enumerate() {
            progress.ensure_not_cancelled()?;
            let n = idx + 1;
            stats.api_requests += 1;
            let url = play_store_url(package_id);
            progress.request(
                "google_play",
                "bundle_id",
                package_id,
                "query",
                format!("GET Play Store listing ({n}/{total}): {url}"),
            );
            match fetch_play_listing(&client, user_agent, package_id).await {
                Ok(mut listing) => {
                    if !listing.on_play_store {
                        if let Some(found) =
                            search_play_listing(&client, user_agent, package_id).await
                        {
                            listing = found;
                        }
                    }
                    stats.api_ok += 1;
                    let status = if listing.on_play_store {
                        "listed"
                    } else {
                        "not_listed"
                    };
                    progress.request(
                        "google_play",
                        "bundle_id",
                        package_id,
                        "query_ok",
                        if listing.on_play_store {
                            let title = if listing.app_title.is_empty() {
                                listing.package_id.as_str()
                            } else {
                                listing.app_title.as_str()
                            };
                            format!("{package_id} → listed as {title}")
                        } else {
                            format!("{package_id} → not on Google Play")
                        },
                    );
                    write_package_enrichment(config, &listing).await?;
                    progress.request(
                        "google_play",
                        "bundle_id",
                        package_id,
                        "write",
                        format!("Stored {status} enrichment for {package_id}"),
                    );
                    written += 1;
                }
                Err(e) => {
                    stats.api_errors += 1;
                    progress.request(
                        "google_play",
                        "bundle_id",
                        package_id,
                        "query_err",
                        format!("Play Store lookup failed for {package_id}: {e}"),
                    );
                }
            }
            if n < total && delay_ms > 0 {
                progress.sleep_cancellable(delay_ms).await?;
            }
        }

        stats.rows_written = written as u32;
        Ok(SyncResult {
            rows_written: written,
            stats,
        })
    }
}

pub fn play_store_url(package_id: &str) -> String {
    format!(
        "https://play.google.com/store/apps/details?id={}&hl=en&gl=US",
        urlencoding::encode(package_id)
    )
}

pub async fn test_google_play_lookup(package_id: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;
    let listing = fetch_play_listing(&client, DEFAULT_USER_AGENT, package_id).await?;
    Ok(if listing.on_play_store {
        let title = if listing.app_title.is_empty() {
            listing.package_id.clone()
        } else {
            listing.app_title.clone()
        };
        format!("Listed on Google Play — {title} ({})", listing.play_store_url)
    } else {
        format!("Not listed on Google Play — {package_id}")
    })
}

async fn fetch_play_listing(
    client: &reqwest::Client,
    user_agent: &str,
    package_id: &str,
) -> anyhow::Result<PlayListing> {
    let url = play_store_url(package_id);
    let resp = client
        .get(&url)
        .header("User-Agent", user_agent)
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await?;
    let status = resp.status().as_u16();
    let body = resp.text().await?;
    Ok(parse_play_store_response(package_id, status, &body))
}

async fn search_play_listing(
    client: &reqwest::Client,
    user_agent: &str,
    package_id: &str,
) -> Option<PlayListing> {
    let url = format!(
        "https://play.google.com/store/search?q={}&c=apps&hl=en&gl=US",
        urlencoding::encode(package_id)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", user_agent)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.text().await.ok()?;
    let found_id = extract_search_result_package_id(&body, package_id)?;
    fetch_play_listing(client, user_agent, &found_id)
        .await
        .ok()
        .filter(|l| l.on_play_store)
        .map(|mut l| {
            let resolved_url = l.play_store_url.clone();
            l.package_id = package_id.to_string();
            l.play_store_url = resolved_url;
            l
        })
}

fn extract_search_result_package_id(body: &str, query: &str) -> Option<String> {
    static ID_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = ID_RE.get_or_init(|| Regex::new(r#"details\?id=([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)"#).unwrap());
    let mut ids: Vec<String> = re
        .captures_iter(body)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
        .collect();
    ids.sort();
    ids.dedup();
    if ids.iter().any(|id| id == query) {
        return Some(query.to_string());
    }
    let query_lower = query.to_lowercase();
    ids.into_iter().find(|id| {
        let id_lower = id.to_lowercase();
        id_lower == query_lower
            || id_lower.starts_with(&format!("{query_lower}."))
            || id_lower.ends_with(&format!(".{query_lower}"))
    })
}

fn parse_play_store_response(package_id: &str, status: u16, body: &str) -> PlayListing {
    let on_play_store = is_play_listing_page(package_id, status, body);
    PlayListing {
        package_id: package_id.to_string(),
        on_play_store,
        play_store_url: play_store_url(package_id),
        app_title: if on_play_store {
            extract_app_title(body)
        } else {
            String::new()
        },
    }
}

fn is_play_not_found_page(status: u16, body: &str) -> bool {
    if status == 404 {
        return true;
    }
    const NOT_FOUND: &[&str] = &[
        "We're sorry, the requested URL was not found",
        "not found on this server",
        "not found on Google Play",
        "ITEM_NOT_FOUND",
        "itemnotfound",
        "<title>Not Found</title>",
    ];
    NOT_FOUND.iter().any(|m| body.contains(m))
}

fn is_play_listing_page(package_id: &str, status: u16, body: &str) -> bool {
    if is_play_not_found_page(status, body) {
        return false;
    }
    if status != 200 {
        return false;
    }
    let pkg_in_page = body.contains(package_id)
        || body.contains(&format!("details?id={package_id}"))
        || body.contains(&format!("details?id={package_id}&amp;"));
    if !pkg_in_page {
        return false;
    }
    body.contains("og:title")
        || body.contains(r#"itemprop="name""#)
        || body.contains("SoftwareApplication")
        || body.contains("play.google.com/store/apps/details")
}

fn extract_app_title(body: &str) -> String {
    static OG_TITLE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let og = OG_TITLE.get_or_init(|| {
        Regex::new(r#"(?i)(?:property=)?["']?og:title["']?\s+content=["']([^"']+)["']"#).unwrap()
    });
    if let Some(caps) = og.captures(body) {
        return decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
    }
    static ITEMPROP: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let item = ITEMPROP.get_or_init(|| {
        Regex::new(r#"(?i)itemprop=["']name["'][^>]*>([^<]+)<"#).unwrap()
    });
    if let Some(caps) = item.captures(body) {
        return decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
    }
    static ITEMPROP_ATTR: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let item_attr = ITEMPROP_ATTR.get_or_init(|| {
        Regex::new(r#"(?i)itemprop=["']name["']\s+content=["']([^"']+)["']"#).unwrap()
    });
    if let Some(caps) = item_attr.captures(body) {
        return decode_html_entities(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
    }
    String::new()
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

fn is_android_package(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 {
        return false;
    }
    value.contains('.')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
}

async fn existing_listed_package_ids(
    config: &AppConfig,
    recheck_not_listed: bool,
) -> anyhow::Result<HashSet<String>> {
    let db = &config.clickhouse_database;
    let sql = if recheck_not_listed {
        format!("SELECT package_id FROM {db}.package_enrichments WHERE on_play_store = 1")
    } else {
        format!("SELECT package_id FROM {db}.package_enrichments")
    };
    let rows = query_json_each_row(config, db, &sql).await.unwrap_or_default();
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            row.get("package_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect())
}

async fn distinct_android_packages(
    config: &AppConfig,
    limit: u32,
    lookback_days: u32,
) -> anyhow::Result<Vec<String>> {
    let db = &config.clickhouse_database;
    let sql = format!(
        "SELECT v FROM ( \
         SELECT bundle_id AS v, max(ingest_time) AS last_seen \
         FROM {db}.events \
         WHERE platform = 'android' AND notEmpty(bundle_id) \
         AND (timestamp >= now() - INTERVAL {lookback_days} DAY \
              OR ingest_time >= now() - INTERVAL {lookback_days} DAY) \
         GROUP BY v \
         ORDER BY last_seen DESC \
         LIMIT {limit})"
    );
    let rows = query_json_each_row(config, db, &sql).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| r.get("v").and_then(|v| v.as_str()).map(String::from))
        .filter(|v| !v.trim().is_empty())
        .collect())
}

async fn write_package_enrichment(config: &AppConfig, listing: &PlayListing) -> anyhow::Result<()> {
    let db = &config.clickhouse_database;
    let on_play = if listing.on_play_store { 1 } else { 0 };
    let sql = format!(
        "INSERT INTO {db}.package_enrichments \
         (package_id, on_play_store, play_store_url, app_title) \
         VALUES ('{}', {on_play}, '{}', '{}')",
        escape_ch(&listing.package_id),
        escape_ch(&listing.play_store_url),
        escape_ch(&listing.app_title),
    );
    exec_sql(config, &sql).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_store_url_encodes_package() {
        assert_eq!(
            play_store_url("com.ubergeek42.WeechatAndroid.dev"),
            "https://play.google.com/store/apps/details?id=com.ubergeek42.WeechatAndroid.dev&hl=en&gl=US"
        );
    }

    #[test]
    fn detects_listed_page() {
        let body = r#"<meta og:title" content="bitchat - Apps on Google Play">
        <a href="/store/apps/details?id=com.bitchat.droid">bitchat</a>
        <span itemprop="name">bitchat</span>"#;
        let listing = parse_play_store_response("com.bitchat.droid", 200, body);
        assert!(listing.on_play_store);
        assert_eq!(listing.app_title, "bitchat - Apps on Google Play");
    }

    #[test]
    fn detects_listed_from_itemprop_text() {
        let body = r#"<a href="https://play.google.com/store/apps/details?id=com.bitchat.droid">
        <span itemprop="name">bitchat</span></a>"#;
        let listing = parse_play_store_response("com.bitchat.droid", 200, body);
        assert!(listing.on_play_store);
        assert_eq!(listing.app_title, "bitchat");
    }

    #[test]
    fn detects_missing_page() {
        let body = "We're sorry, the requested URL was not found on this server.";
        let listing = parse_play_store_response("com.example.notreal", 404, body);
        assert!(!listing.on_play_store);
    }

    #[test]
    fn validates_android_package_names() {
        assert!(is_android_package("com.ubergeek42.WeechatAndroid.dev"));
        assert!(!is_android_package("not-a-package"));
        assert!(!is_android_package(""));
    }
}
