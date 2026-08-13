//! mobipwn-dac — deploy rules/queries from a directory to the mobipwn API (nanodac-style).

use anyhow::Context;
use clap::Parser;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "mobipwn-dac")]
struct Cli {
    #[arg(long, env = "MOBIPWN_API_URL", default_value = "http://127.0.0.1:3000")]
    api: String,
    #[arg(long, env = "MOBIPWN_API_KEY")]
    api_key: Option<String>,
    #[arg(long, default_value = "deploy")]
    command: String,
    /// Directory with `rules/**/*.yaml` and `queries/**/*.yaml`
    #[arg(default_value = ".")]
    path: PathBuf,
}

#[derive(Deserialize)]
struct RuleFile {
    name: String,
    query: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_severity")]
    severity: String,
    #[serde(default)]
    cron: Option<String>,
    #[serde(default)]
    lifecycle: String,
}

#[derive(Deserialize)]
struct QueryFile {
    name: String,
    query: String,
    #[serde(default)]
    description: String,
}

fn default_severity() -> String {
    "medium".into()
}

fn collect_yaml(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            out.extend(collect_yaml(&path)?);
        } else if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if cli.command != "deploy" {
        anyhow::bail!("only 'deploy' is supported");
    }
    let client = reqwest::Client::new();
    let api = cli.api.trim_end_matches('/');

    for path in collect_yaml(&cli.path.join("rules"))? {
        let body: RuleFile =
            serde_yaml::from_str(&std::fs::read_to_string(&path)?).context("parse rule yaml")?;
        let mut req = client.post(format!("{api}/v1/rules")).json(&serde_json::json!({
            "name": body.name,
            "description": body.description,
            "query": body.query,
            "severity": body.severity,
            "cron": body.cron,
            "lifecycle": body.lifecycle,
        }));
        if let Some(ref key) = cli.api_key {
            req = req.header("X-API-Key", key);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("rule {}: {}", body.name, resp.text().await?);
        }
        println!("deployed rule {} ({})", body.name, path.display());
    }

    for path in collect_yaml(&cli.path.join("queries"))? {
        let body: QueryFile =
            serde_yaml::from_str(&std::fs::read_to_string(&path)?).context("parse query yaml")?;
        let mut req = client.post(format!("{api}/v1/saved-queries")).json(&serde_json::json!({
            "name": body.name,
            "description": body.description,
            "query": body.query,
        }));
        if let Some(ref key) = cli.api_key {
            req = req.header("X-API-Key", key);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("query {}: {}", body.name, resp.text().await?);
        }
        println!("deployed query {} ({})", body.name, path.display());
    }

    Ok(())
}
