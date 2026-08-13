use crate::platform_settings::{load_mcp_config, save_mcp_config, McpConfig};
use crate::store::SettingsRepository;
use crate::config::AppConfig;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

struct Inner {
    child: Option<Child>,
    started_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
}

#[derive(Clone)]
pub struct McpSupervisor {
    config: AppConfig,
    settings: Arc<SettingsRepository>,
    inner: Arc<Mutex<Inner>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub auto_start: bool,
    pub binary_path: String,
    pub binary_found: bool,
    pub api_url: String,
    pub api_key_set: bool,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub cursor_config: Value,
}

impl McpSupervisor {
    pub fn new(config: AppConfig, settings: Arc<SettingsRepository>) -> Self {
        Self {
            config,
            settings,
            inner: Arc::new(Mutex::new(Inner {
                child: None,
                started_at: None,
                last_error: None,
            })),
        }
    }

    pub async fn auto_start_if_configured(&self) -> anyhow::Result<()> {
        let cfg = load_mcp_config(&self.settings, &self.config).await?;
        if cfg.auto_start {
            self.start().await?;
        }
        Ok(())
    }

    pub async fn status(&self) -> anyhow::Result<McpStatus> {
        let cfg = load_mcp_config(&self.settings, &self.config).await?;
        let binary = resolve_mcp_binary(&cfg);
        let binary_path = binary.display().to_string();
        let binary_found = binary.is_file();

        let mut inner = self.inner.lock().await;
        if let Some(child) = inner.child.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                if !status.success() {
                    inner.last_error = Some(format!("mobipwn-mcp exited with {status}"));
                }
                inner.child = None;
                inner.started_at = None;
            }
        }

        let running = inner.child.is_some();
        let pid = inner.child.as_ref().and_then(|c| c.id());
        let started_at = inner.started_at.map(|t| t.to_rfc3339());
        let last_error = inner.last_error.clone();

        Ok(McpStatus {
            running,
            pid,
            auto_start: cfg.auto_start,
            binary_path: binary_path.clone(),
            binary_found,
            api_url: cfg.api_url.clone(),
            api_key_set: !cfg.api_key.is_empty(),
            started_at,
            last_error,
            cursor_config: cursor_config_snippet(&binary_path, &cfg),
        })
    }

    pub async fn start(&self) -> anyhow::Result<McpStatus> {
        let cfg = load_mcp_config(&self.settings, &self.config).await?;
        let binary = resolve_mcp_binary(&cfg);
        if !binary.is_file() {
            anyhow::bail!(
                "mobipwn-mcp binary not found at {} — build with `cargo build -p mobipwn-mcp` or set binary_path",
                binary.display()
            );
        }

        let mut inner = self.inner.lock().await;
        if inner.child.is_some() {
            drop(inner);
            return self.status().await;
        }

        let mut cmd = Command::new(&binary);
        cmd.env("MOBIPWN_API_URL", cfg.api_url.trim());
        if !cfg.api_key.is_empty() {
            cmd.env("MOBIPWN_API_KEY", &cfg.api_key);
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            anyhow::anyhow!("failed to spawn {}: {e}", binary.display())
        })?;

        let pid = child.id();
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target: "mobipwn_mcp", "{line}");
                }
            });
        }
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::trace!(target: "mobipwn_mcp", "{line}");
                }
            });
        }

        inner.last_error = None;
        inner.started_at = Some(Utc::now());
        inner.child = Some(child);
        drop(inner);

        tracing::info!(pid = ?pid, binary = %binary.display(), "mobipwn-mcp started");
        self.status().await
    }

    pub async fn stop(&self) -> anyhow::Result<McpStatus> {
        let mut inner = self.inner.lock().await;
        if let Some(mut child) = inner.child.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
            tracing::info!("mobipwn-mcp stopped");
        }
        inner.started_at = None;
        drop(inner);
        self.status().await
    }

    pub async fn save_config_and_apply(&self, incoming: &McpConfig) -> anyhow::Result<McpStatus> {
        save_mcp_config(&self.settings, incoming).await?;
        let cfg = load_mcp_config(&self.settings, &self.config).await?;
        if cfg.auto_start {
            self.status().await
        } else {
            self.stop().await
        }
    }
}

pub fn resolve_mcp_binary(cfg: &McpConfig) -> PathBuf {
    let trimmed = cfg.binary_path.trim();
    if !trimmed.is_empty() {
        return PathBuf::from(trimmed);
    }
    if let Ok(p) = std::env::var("MOBIPWN_MCP_BIN") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["mobipwn-mcp", "mobipwn-mcp.exe"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return candidate;
                }
            }
            if let Some(parent) = dir.parent() {
                for sub in ["debug", "release"] {
                    let candidate = parent.join(sub).join("mobipwn-mcp");
                    if candidate.is_file() {
                        return candidate;
                    }
                }
            }
            if let Some(root) = workspace_root_from_exe(dir) {
                for sub in ["target/debug/mobipwn-mcp", "target/release/mobipwn-mcp"] {
                    let candidate = root.join(sub);
                    if candidate.is_file() {
                        return candidate;
                    }
                }
            }
        }
    }
    PathBuf::from("mobipwn-mcp")
}

fn workspace_root_from_exe(mut dir: &Path) -> Option<PathBuf> {
    for _ in 0..6 {
        if dir.join("Cargo.toml").is_file() && dir.join("mobipwn-mcp").is_dir() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
    None
}

fn cursor_config_snippet(binary_path: &str, cfg: &McpConfig) -> Value {
    let mut env = json!({
        "MOBIPWN_API_URL": cfg.api_url.trim(),
    });
    if !cfg.api_key.is_empty() {
        env["MOBIPWN_API_KEY"] = Value::String(cfg.api_key.clone());
    }
    json!({
        "mcpServers": {
            "mobipwn": {
                "command": binary_path,
                "env": env
            }
        }
    })
}
