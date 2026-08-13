import type { IronSiftRun } from "@/lib/ironsift";

export type IronSiftRunReportJson = {
  kind?: string;
  process_log_count?: number;
  event_count?: number;
  distinct_machines?: number;
  total_analyzed?: number;
  anomalies_detected?: number;
  anomaly_count?: number;
  affected_hosts?: number;
  min_score?: number;
  min_fleet_devices?: number;
  status_reason?: string;
  severity_counts?: Record<string, number>;
  cluster_stats?: Record<string, number>;
  clusters_found?: number;
  noise_machines?: number;
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function parseIronSiftRunReport(run: IronSiftRun): IronSiftRunReportJson | null {
  const raw = run.report_json;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as IronSiftRunReportJson;
}

function severitySummary(
  counts: Record<string, number> | undefined,
  t: Translate
): string {
  if (!counts) return "";
  const parts = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    .filter((level) => (counts[level] ?? 0) > 0)
    .map((level) => t("ironsift.reportSeverityLevel", { level, count: counts[level] ?? 0 }));
  return parts.join(", ");
}

export function formatIronSiftRunCompleteDetail(run: IronSiftRun, t: Translate): string {
  const report = parseIronSiftRunReport(run);
  if (run.status === "skipped" && report?.status_reason === "insufficient_devices") {
    return t("ironsift.runSkippedInsufficient", {
      hosts: report.distinct_machines ?? run.fleet_size,
      min: report.min_fleet_devices ?? 3,
      events: report.event_count ?? report.process_log_count ?? 0,
    });
  }
  if (report?.kind === "process_fleet") {
    const severity = severitySummary(report.severity_counts, t);
    if ((run.anomaly_count ?? 0) === 0) {
      return t("ironsift.runCompleteProcessClean", {
        logs: report.process_log_count ?? 0,
        hosts: report.distinct_machines ?? run.fleet_size,
        profiled: report.total_analyzed ?? run.fleet_size,
        minScore: (report.min_score ?? 0.4).toFixed(2),
        detected: report.anomalies_detected ?? 0,
      });
    }
    return t("ironsift.runCompleteProcess", {
      logs: report.process_log_count ?? 0,
      hosts: report.distinct_machines ?? run.fleet_size,
      profiled: report.total_analyzed ?? run.fleet_size,
      findings: run.anomaly_count,
      affected: report.affected_hosts ?? run.anomaly_count,
      severity: severity ? ` · ${severity}` : "",
      detected: report.anomalies_detected ?? run.anomaly_count,
    });
  }
  return t("ironsift.completeDetail", { findings: run.anomaly_count });
}

export function formatIronSiftRunSuccess(run: IronSiftRun, t: Translate): string {
  if (run.summary?.trim()) return run.summary;
  return formatIronSiftRunCompleteDetail(run, t);
}

export type IronSiftRunReportRow = {
  label: string;
  value: string;
};

export function ironSiftRunReportRows(
  run: IronSiftRun,
  t: Translate
): IronSiftRunReportRow[] {
  const report = parseIronSiftRunReport(run);
  if (!report) {
    return [
      { label: t("ironsift.reportStatus"), value: run.status },
      { label: t("ironsift.reportDevices"), value: String(run.fleet_size) },
      { label: t("ironsift.reportFindings"), value: String(run.anomaly_count) },
    ];
  }

  const rows: IronSiftRunReportRow[] = [
    { label: t("ironsift.reportStatus"), value: run.status },
  ];

  if (run.ironsift_config_name) {
    rows.push({
      label: t("ironsift.reportIronSiftConfig"),
      value: run.ironsift_config_name,
    });
  }
  if (run.anomark_config_name) {
    rows.push({
      label: t("ironsift.reportAnomarkConfig"),
      value: run.anomark_config_name,
    });
  }

  if (report.process_log_count != null) {
    rows.push({
      label: t("ironsift.reportProcessLogs"),
      value: report.process_log_count.toLocaleString(),
    });
  } else if (report.event_count != null) {
    rows.push({
      label: t("ironsift.reportEvents"),
      value: report.event_count.toLocaleString(),
    });
  }

  if (report.distinct_machines != null) {
    rows.push({
      label: t("ironsift.reportHosts"),
      value: String(report.distinct_machines),
    });
  }

  if (report.total_analyzed != null) {
    rows.push({
      label: t("ironsift.reportProfiled"),
      value: String(report.total_analyzed),
    });
  }

  if (report.anomalies_detected != null) {
    rows.push({
      label: t("ironsift.reportAnomaliesDetected"),
      value: String(report.anomalies_detected),
    });
  }

  if (report.min_score != null) {
    rows.push({
      label: t("ironsift.reportMinScore"),
      value: report.min_score.toFixed(2),
    });
  }

  rows.push({
    label: t("ironsift.reportFindingsSaved"),
    value: String(run.anomaly_count),
  });

  if (report.affected_hosts != null && run.anomaly_count > 0) {
    rows.push({
      label: t("ironsift.reportAffectedHosts"),
      value: String(report.affected_hosts),
    });
  }

  const severity = severitySummary(report.severity_counts, t);
  if (severity) {
    rows.push({ label: t("ironsift.reportSeverity"), value: severity });
  }

  if (report.clusters_found != null) {
    rows.push({
      label: t("ironsift.reportClusters"),
      value: String(report.clusters_found),
    });
  }

  if (report.noise_machines != null) {
    rows.push({
      label: t("ironsift.reportNoise"),
      value: String(report.noise_machines),
    });
  }

  if (report.status_reason === "insufficient_devices" && report.min_fleet_devices != null) {
    rows.push({
      label: t("ironsift.reportMinFleet"),
      value: String(report.min_fleet_devices),
    });
  }

  return rows;
}
