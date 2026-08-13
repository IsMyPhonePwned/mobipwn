//! CLI: parse Android bugreport / iOS sysdiagnose and send events to mobipwn SIEM.
//!
//! Examples:
//!   mobipwn-ingest bugreport -i /path/to/bugreport.zip -s case-2024-001
//!   mobipwn-ingest sysdiagnose -i /path/to/sysdiagnose.tar.gz -s case-2024-001
//!   mobipwn-ingest bugreport -i bugreport.txt -s lab-1 --api http://127.0.0.1:3000
//!   mobipwn-ingest delete -s case-2024-001

use anyhow::Context;
use clap::{Parser, Subcommand};
use mobipwn_core::config::AppConfig;
use mobipwn_core::mudm::{canonical, TimelinePlatform, ENDPOINT};
use mobipwn_core::{
    delete_ingest_source, load_sysdiagnose_ingest_config, run_migrations, sigma_convert,
    AlertRepository, CaseRepository, CollectBlobRepository, DualPool, IngestJobRepository,
    SettingsRepository,
};
use std::sync::Arc;
use sqlx::postgres::PgPoolOptions;
use mobipwn_ingest::{
    ingest_jsonl, insert_events, sysdiagnose_archive_options_from_config,
    sysdiagnose_parse_options_from_config,
};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "mobipwn-ingest",
    about = "Parse mobile forensic archives and ingest into mobipwn (ClickHouse or API)"
)]
struct Cli {
    /// mobipwn API base URL (e.g. http://127.0.0.1:3000). When set, ingest via HTTP instead of ClickHouse.
    #[arg(long, env = "MOBIPWN_API_URL")]
    api: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Parse an Android bugreport (.txt or .zip) with bugreport-extractor-library.
    Bugreport {
        #[arg(short, long)]
        input: PathBuf,
        /// Case / device label stored in `source` (e.g. case-2024-001).
        #[arg(short, long)]
        source: String,
        /// Analyst / owner on the investigation case.
        #[arg(short, long)]
        user: Option<String>,
    },
    /// Parse an iOS sysdiagnose archive (.tar.gz) with sysdiagnose-extractor-library.
    Sysdiagnose {
        #[arg(short, long)]
        input: PathBuf,
        #[arg(short, long)]
        source: String,
        #[arg(short, long)]
        user: Option<String>,
    },
    /// Ingest a timeline JSONL file (e.g. from bel-cli --timeline-jsonl).
    Jsonl {
        #[arg(short, long)]
        input: PathBuf,
        #[arg(short, long, default_value = "android")]
        platform: String,
        #[arg(short, long)]
        source: String,
    },
    /// Delete all events and metadata for an ingest source label.
    Delete {
        #[arg(short, long)]
        source: String,
    },
    /// Convert website/Sigma YAML rules to mobipwn mPL (DAC yaml + optional SQL seed).
    ImportRules {
        /// Directory with `*.yml` rules (e.g. ../website/rules).
        #[arg(long)]
        input: PathBuf,
        /// Output directory for mobipwn-dac rule YAML files.
        #[arg(long)]
        output: PathBuf,
        /// Optional Postgres seed SQL path (INSERT … WHERE NOT EXISTS).
        #[arg(long)]
        sql: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("mobipwn_ingest=info".parse()?),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Bugreport { input, source, user } => {
            run_bugreport(&input, &source, user.as_deref(), cli.api.as_deref()).await?;
        }
        Commands::Sysdiagnose { input, source, user } => {
            run_sysdiagnose(&input, &source, user.as_deref(), cli.api.as_deref()).await?;
        }
        Commands::Jsonl {
            input,
            platform,
            source,
        } => {
            run_jsonl(&input, &platform, &source, cli.api.as_deref()).await?;
        }
        Commands::Delete { source } => {
            run_delete(&source, cli.api.as_deref()).await?;
        }
        Commands::ImportRules {
            input,
            output,
            sql,
        } => {
            run_import_rules(&input, &output, sql.as_deref())?;
        }
    }

    Ok(())
}

fn run_import_rules(
    input: &std::path::Path,
    output: &std::path::Path,
    sql: Option<&std::path::Path>,
) -> anyhow::Result<()> {
    let rules = sigma_convert::convert_rules_dir(input, true)?;
    println!("Converted {} rules from {}", rules.len(), input.display());
    for (stem, rule) in &rules {
        sigma_convert::write_dac_yaml(output, stem, rule)?;
        println!("  {stem}.yaml — {}", rule.name);
    }
    if let Some(sql_path) = sql {
        sigma_convert::write_rules_sql(sql_path, &rules)?;
        println!("Wrote SQL seed: {}", sql_path.display());
    }
    Ok(())
}

async fn run_delete(source: &str, api: Option<&str>) -> anyhow::Result<()> {
    if let Some(base) = api {
        let url = format!(
            "{}/v1/data/sources/delete",
            base.trim_end_matches('/')
        );
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "source": source }))
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("delete API {status}: {body}");
        }
        println!("{body}");
        return Ok(());
    }

    let config = AppConfig::from_env();
    let pool = Arc::new(DualPool::connect(&config).await.context("connect pools")?);
    run_migrations(&pool.postgres).await?;
    let cases = CaseRepository::new(pool.postgres.clone());
    let ingest_jobs = IngestJobRepository::new(pool.postgres.clone());
    let collect_blobs = CollectBlobRepository::new(pool.postgres.clone());
    let alerts = AlertRepository::new(pool.postgres.clone());
    let result = delete_ingest_source(
        &pool,
        &config,
        &cases,
        &ingest_jobs,
        &collect_blobs,
        &alerts,
        source,
    )
    .await?;
    println!(
        "Deleted source \"{}\" — {} events, {} case(s), {} ingest job(s), {} blob(s), {} alert(s)",
        result.source,
        result.events_deleted,
        result.cases_removed,
        result.ingest_jobs_removed,
        result.collect_blobs_removed,
        result.alerts_removed,
    );
    Ok(())
}

async fn run_bugreport(
    path: &PathBuf,
    source: &str,
    user: Option<&str>,
    api: Option<&str>,
) -> anyhow::Result<()> {
    tracing::info!(?path, %source, "parsing Android bugreport");
    let (events, report) = mobipwn_ingest::parse_android_bugreport(path, source)
        .with_context(|| format!("parse bugreport: {}", path.display()))?;
    report.log_tracing();
    report.print_stdout();
    sync_case_for_source(source, "android", user).await;
    send_events(&events, "android", source, user, api).await
}

async fn load_sysdiagnose_ingest_options() -> (
    sysdiagnose_extractor_library::ParseOptions,
    sysdiagnose_extractor_library::ArchiveOptions,
) {
    let config = AppConfig::from_env();
    if let Ok(pool) = PgPoolOptions::new()
        .max_connections(1)
        .connect(&config.postgres_url)
        .await
    {
        let settings = SettingsRepository::new(pool);
        if let Ok(cfg) = load_sysdiagnose_ingest_config(&settings).await {
            return (
                sysdiagnose_parse_options_from_config(&cfg),
                sysdiagnose_archive_options_from_config(&cfg),
            );
        }
    }
    (
        sysdiagnose_extractor_library::ParseOptions::default(),
        sysdiagnose_extractor_library::ArchiveOptions::default(),
    )
}

async fn run_sysdiagnose(
    path: &PathBuf,
    source: &str,
    user: Option<&str>,
    api: Option<&str>,
) -> anyhow::Result<()> {
    tracing::info!(?path, %source, "parsing iOS sysdiagnose");
    let (parse_options, archive_options) = load_sysdiagnose_ingest_options().await;
    let events = mobipwn_ingest::ingest_ios_sysdiagnose(path, source, parse_options, archive_options)
        .with_context(|| format!("parse sysdiagnose: {}", path.display()))?;
    sync_case_for_source(source, "ios", user).await;
    send_events(&events, "ios", source, user, api).await
}

async fn sync_case_for_source(source: &str, platform: &str, user: Option<&str>) {
    let config = AppConfig::from_env();
    match PgPoolOptions::new()
        .max_connections(2)
        .connect(&config.postgres_url)
        .await
    {
        Ok(pool) => {
            if let Err(e) = run_migrations(&pool).await {
                tracing::warn!(
                    error = %e,
                    "Postgres schema patch failed — case may not appear in Case search"
                );
            }
            let repo = CaseRepository::new(pool);
            let ch = config.clickhouse_client();
            match repo.ensure_for_ingest_source(source, platform, user).await {
                Ok((c, is_new)) => {
                    if is_new {
                        let _ = mobipwn_core::emit_case_audit(
                            &ch,
                            &c,
                            mobipwn_core::CaseAuditAction::Created,
                            &mobipwn_core::CaseAuditActor::system(),
                            mobipwn_core::CaseAuditExtras {
                                grouping_type: Some("ingest".into()),
                                ..Default::default()
                            },
                        )
                        .await;
                    }
                    tracing::info!(case_id = %c.id, %source, "linked ingest to investigation case");
                    println!("Case search: linked source \"{source}\" (case id {})", c.id);
                }
                Err(e) => tracing::warn!(
                    error = %e,
                    %source,
                    "could not create investigation case — events are still in ClickHouse; \
                     open Data/Search with source=\"{source}\" or run ./dev.sh then re-ingest"
                ),
            }
        }
        Err(e) => tracing::warn!(
            error = %e,
            "Postgres unavailable — skip case sync (events still in ClickHouse if insert succeeded)"
        ),
    }
}

async fn run_jsonl(
    path: &PathBuf,
    platform: &str,
    source: &str,
    api: Option<&str>,
) -> anyhow::Result<()> {
    let jsonl = std::fs::read_to_string(path)
        .with_context(|| format!("read jsonl: {}", path.display()))?;
    let platform_label = canonical(platform);
    let plat = match platform_label.as_str() {
        "android" => TimelinePlatform::AndroidBugreport,
        "ios" => TimelinePlatform::IosSysdiagnose,
        ENDPOINT => TimelinePlatform::Vector,
        other => anyhow::bail!("platform must be android, ios, endpoint, or vector (got {other})"),
    };
    let events = ingest_jsonl(&jsonl, plat, source);
    send_events(&events, &platform_label, source, None, api).await
}

async fn send_events(
    events: &[mobipwn_core::mudm::MudmEvent],
    platform: &str,
    source: &str,
    _user: Option<&str>,
    api: Option<&str>,
) -> anyhow::Result<()> {
    if events.is_empty() {
        tracing::warn!("no events produced — nothing to ingest");
        return Ok(());
    }

    let count = if let Some(base) = api {
        ingest_via_api(base, platform, source, events).await?
    } else {
        ingest_via_clickhouse(events).await?
    };

    tracing::info!(%count, %platform, %source, "ingest complete");
    println!("Ingested {count} events (platform={platform}, source={source})");
    Ok(())
}

async fn ingest_via_clickhouse(
    events: &[mobipwn_core::mudm::MudmEvent],
) -> anyhow::Result<usize> {
    let config = AppConfig::from_env();
    insert_events(&config.clickhouse_client(), events).await
}

async fn ingest_via_api(
    base: &str,
    platform: &str,
    source: &str,
    events: &[mobipwn_core::mudm::MudmEvent],
) -> anyhow::Result<usize> {
    let jsonl = events_to_jsonl(events);
    let url = format!(
        "{}/v1/ingest/jsonl",
        base.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "platform": platform,
            "source": source,
            "jsonl": jsonl,
        }))
        .send()
        .await?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("API ingest failed: {body}");
    }
    let v: serde_json::Value = resp.json().await?;
    Ok(v.get("ingested")
        .and_then(|n| n.as_u64())
        .unwrap_or(events.len() as u64) as usize)
}

fn events_to_jsonl(events: &[mobipwn_core::mudm::MudmEvent]) -> String {
    use mobipwn_core::mudm::TimelinePlatform;

    let platform = events
        .first()
        .map(|e| e.platform.as_str())
        .unwrap_or(ENDPOINT);

    let plat = if platform == "ios" {
        TimelinePlatform::IosSysdiagnose
    } else if platform == "android" {
        TimelinePlatform::AndroidBugreport
    } else {
        TimelinePlatform::Vector
    };

    // Re-normalize is unnecessary; emit minimal timeline lines for API path.
    let _ = plat;
    events
        .iter()
        .filter_map(|ev| {
            let mut obj = serde_json::Map::new();
            obj.insert("message".into(), serde_json::json!(ev.message));
            obj.insert(
                "datetime".into(),
                serde_json::json!(ev.timestamp.to_rfc3339()),
            );
            obj.insert(
                "timestamp".into(),
                serde_json::json!(ev.timestamp.timestamp_micros()),
            );
            obj.insert("platform".into(), serde_json::json!(ev.platform));
            obj.insert("parser".into(), serde_json::json!(ev.parser));
            obj.insert("data_type".into(), serde_json::json!(ev.data_type));
            obj.insert(
                "event_time_binding".into(),
                serde_json::json!(ev.event_time_binding),
            );
            obj.insert("bundle_id".into(), serde_json::json!(ev.bundle_id));
            if let Some(ext) = ev.ext.as_object() {
                for (k, v) in ext {
                    obj.insert(k.clone(), v.clone());
                }
            }
            serde_json::to_string(&serde_json::Value::Object(obj)).ok()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
