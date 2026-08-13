use serde::Serialize;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct DockerContainerStats {
    /// Compose container name, e.g. mobipwn-clickhouse-1
    pub container: String,
    /// Short service label, e.g. clickhouse, postgres
    pub service: String,
    pub running: bool,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub memory_limit_bytes: Option<u64>,
}

/// Docker stats for mobipwn compose containers (dev). Empty if docker is unavailable.
pub async fn fetch_docker_container_stats() -> Vec<DockerContainerStats> {
    let output = match Command::new("docker")
        .args([
            "stats",
            "--no-stream",
            "--format",
            "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };

    let text = String::from_utf8_lossy(&output);
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((name, cpu_raw, mem_raw)) = parse_docker_stats_line(line) else {
            continue;
        };
        if !name.contains("mobipwn") {
            continue;
        }
        let service = docker_service_label(&name);
        let (memory_bytes, memory_limit_bytes) = parse_mem_usage(mem_raw);
        out.push(DockerContainerStats {
            container: name,
            service,
            running: true,
            cpu_percent: parse_cpu_percent(cpu_raw),
            memory_bytes,
            memory_limit_bytes,
        });
    }
    out.sort_by(|a, b| a.service.cmp(&b.service));
    out
}

fn parse_docker_stats_line(line: &str) -> Option<(String, &str, &str)> {
    let mut parts = line.splitn(3, '\t');
    let name = parts.next()?.trim().to_string();
    let cpu = parts.next()?.trim();
    let mem = parts.next()?.trim();
    if name.is_empty() {
        return None;
    }
    Some((name, cpu, mem))
}

fn docker_service_label(container: &str) -> String {
    container
        .trim_start_matches("mobipwn-")
        .trim_end_matches(|c: char| c.is_ascii_digit() || c == '-')
        .to_string()
}

fn parse_cpu_percent(raw: &str) -> f32 {
    raw.trim()
        .trim_end_matches('%')
        .parse()
        .unwrap_or(0.0)
}

fn parse_mem_usage(raw: &str) -> (u64, Option<u64>) {
    let (used, limit) = raw.split_once(" / ").unwrap_or((raw, ""));
    (
        parse_docker_size(used.trim()),
        if limit.trim().is_empty() {
            None
        } else {
            Some(parse_docker_size(limit.trim()))
        },
    )
}

fn parse_docker_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    let (num, unit) = s.split_at(
        s.find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(s.len()),
    );
    let value: f64 = num.parse().unwrap_or(0.0);
    let mult = match unit.trim().to_uppercase().as_str() {
        "B" | "" => 1.0,
        "KIB" | "KB" => 1024.0,
        "MIB" | "MB" => 1024.0 * 1024.0,
        "GIB" | "GB" => 1024.0 * 1024.0 * 1024.0,
        "TIB" | "TB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (value * mult) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_line() {
        let line = "mobipwn-clickhouse-1\t3.53%\t730.4MiB / 7.652GiB";
        let (name, cpu, mem) = parse_docker_stats_line(line).unwrap();
        assert_eq!(name, "mobipwn-clickhouse-1");
        assert_eq!(parse_cpu_percent(cpu), 3.53);
        let (used, limit) = parse_mem_usage(mem);
        assert!(used > 700_000_000);
        assert!(limit.unwrap_or(0) > 7_000_000_000);
        assert_eq!(docker_service_label(&name), "clickhouse");
    }
}
