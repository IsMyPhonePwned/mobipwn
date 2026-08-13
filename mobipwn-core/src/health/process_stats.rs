use serde::Serialize;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use sysinfo::{get_current_pid, ProcessesToUpdate, System};
use tokio::sync::Mutex;

const PROCESS_CACHE_TTL: Duration = Duration::from_secs(5);

struct ProcessHealthCache {
    at: Instant,
    current: ProcessStats,
    crates: Vec<CrateProcessStats>,
}

static PROCESS_HEALTH_CACHE: LazyLock<Mutex<Option<ProcessHealthCache>>> =
    LazyLock::new(|| Mutex::new(None));

/// Workspace binaries we report on the health page (running or not).
const MOBIPWN_CRATES: &[&str] = &[
    "mobipwn-api",
    "mobipwn-jobs",
    "mobipwn-search",
    "mobipwn-ingest",
    "mobipwn-dac",
    "mobipwn-mcp",
];

/// Library crates embedded in a host binary (shown when the host process is running).
const EMBEDDED_CRATES: &[(&str, &str)] = &[("mobipwn-ironsift", "mobipwn-api")];

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStats {
    pub pid: u32,
    pub name: String,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub uptime_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CrateProcessStats {
    pub crate_name: String,
    pub pid: Option<u32>,
    pub running: bool,
    /// Library crate loaded inside another mobipwn binary (no separate process).
    #[serde(default, skip_serializing_if = "is_false")]
    pub embedded: bool,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub uptime_secs: u64,
}

impl ProcessStats {
    fn unknown() -> Self {
        Self {
            pid: std::process::id(),
            name: "mobipwn-api".into(),
            memory_bytes: 0,
            cpu_percent: 0.0,
            uptime_secs: 0,
        }
    }

    fn from_process(pid: sysinfo::Pid, process: &sysinfo::Process, name: &str) -> Self {
        Self {
            pid: pid.as_u32(),
            name: name.to_string(),
            memory_bytes: process.memory(),
            cpu_percent: process.cpu_usage(),
            uptime_secs: process.run_time(),
        }
    }
}

fn is_mobipwn_crate(name: &str) -> bool {
    name.starts_with("mobipwn-") && MOBIPWN_CRATES.contains(&name)
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn mobipwn_crate_name(process: &sysinfo::Process) -> Option<String> {
    for arg in process.cmd() {
        let s = arg.to_string_lossy();
        if let Some(base) = s.rsplit('/').next().or(s.rsplit('\\').next()) {
            if is_mobipwn_crate(base) {
                return Some(base.to_string());
            }
        }
        if is_mobipwn_crate(&s) {
            return Some(s.into_owned());
        }
    }
    let name = process.name().to_string_lossy();
    if is_mobipwn_crate(&name) {
        return Some(name.into_owned());
    }
    None
}

pub async fn fetch_mobipwn_process_health() -> (ProcessStats, Vec<CrateProcessStats>) {
    let mut cache = PROCESS_HEALTH_CACHE.lock().await;
    if let Some(entry) = cache.as_ref() {
        if entry.at.elapsed() < PROCESS_CACHE_TTL {
            return (entry.current.clone(), entry.crates.clone());
        }
    }
    let (current, crates) = fetch_mobipwn_process_health_uncached().await;
    *cache = Some(ProcessHealthCache {
        at: Instant::now(),
        current: current.clone(),
        crates: crates.clone(),
    });
    (current, crates)
}

async fn fetch_mobipwn_process_health_uncached() -> (ProcessStats, Vec<CrateProcessStats>) {
    let current_pid = get_current_pid().ok();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut found: Vec<CrateProcessStats> = Vec::new();
    let mut current = ProcessStats::unknown();

    for (pid, process) in system.processes() {
        let Some(crate_name) = mobipwn_crate_name(process) else {
            continue;
        };
        let stats = CrateProcessStats {
            crate_name: crate_name.clone(),
            pid: Some(pid.as_u32()),
            running: true,
            embedded: false,
            memory_bytes: process.memory(),
            cpu_percent: process.cpu_usage(),
            uptime_secs: process.run_time(),
        };
        if current_pid == Some(*pid) {
            current = ProcessStats::from_process(*pid, process, &crate_name);
        }
        found.push(stats);
    }

    found.sort_by(|a, b| a.crate_name.cmp(&b.crate_name));

    let mut crates = Vec::new();
    for &name in MOBIPWN_CRATES {
        if let Some(running) = found.iter().find(|c| c.crate_name == name) {
            crates.push(running.clone());
        } else {
            crates.push(CrateProcessStats {
                crate_name: name.to_string(),
                pid: None,
                running: false,
                embedded: false,
                memory_bytes: 0,
                cpu_percent: 0.0,
                uptime_secs: 0,
            });
        }
    }

    for (embedded, host) in EMBEDDED_CRATES {
        if crates.iter().any(|c| c.crate_name == *embedded) {
            continue;
        }
        if let Some(host_stats) = crates.iter().find(|c| c.crate_name == *host && c.running) {
            crates.push(CrateProcessStats {
                crate_name: embedded.to_string(),
                pid: host_stats.pid,
                running: true,
                embedded: true,
                memory_bytes: 0,
                cpu_percent: 0.0,
                uptime_secs: host_stats.uptime_secs,
            });
        } else {
            crates.push(CrateProcessStats {
                crate_name: embedded.to_string(),
                pid: None,
                running: false,
                embedded: true,
                memory_bytes: 0,
                cpu_percent: 0.0,
                uptime_secs: 0,
            });
        }
    }

    crates.sort_by(|a, b| a.crate_name.cmp(&b.crate_name));

    // Include any extra mobipwn-* processes not in the static list (e.g. custom builds).
    for extra in found {
        if !crates.iter().any(|c| c.crate_name == extra.crate_name) {
            crates.push(extra);
        }
    }

    (current, crates)
}
