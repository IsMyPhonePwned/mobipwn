import { apiFetch } from "@/lib/api";

export const ALERT_TO_SIEM_PLUGIN_ID = "alert_to_siem";

export type SiemDestination = "splunk_hec";
export type SplunkHostMode = "fixed" | "device_id" | "source" | "platform";
export type SplunkHecEndpoint = "event" | "raw";

export type AlertToSiemConfigPublic = {
  forward_enabled: boolean;
  destination: SiemDestination;
  splunk_hec_url: string;
  splunk_token_set: boolean;
  splunk_index: string;
  splunk_sourcetype: string;
  splunk_source: string;
  splunk_host: string;
  splunk_host_mode: SplunkHostMode;
  splunk_channel: string;
  hec_endpoint: SplunkHecEndpoint;
  verify_tls: boolean;
  http_timeout_secs: number;
  forward_on_update: boolean;
  forward_on_status_change: boolean;
  status_forward_statuses: string[];
  forward_only_open_alerts: boolean;
  min_severity: string | null;
  include_sample_event: boolean;
  use_alert_timestamp: boolean;
  extra_event_fields: Record<string, unknown>;
  rule_ids_include: string[];
  rule_ids_exclude: string[];
};

export type AlertToSiemConfigInput = Omit<AlertToSiemConfigPublic, "splunk_token_set"> & {
  splunk_token: string;
};

export type AlertSiemForwardLog = {
  id: string;
  alert_id: string | null;
  event_kind: string;
  destination: string;
  siem_type: string;
  status: string;
  http_status: number | null;
  error_message: string | null;
  payload_summary: {
    title?: string;
    rule_name?: string;
    severity?: string;
    alert_id?: string;
    status_from?: string;
    status_to?: string;
  };
  created_at: string;
};

export async function fetchAlertToSiemConfig() {
  return apiFetch<AlertToSiemConfigPublic>("/v1/alert-siem/config");
}

export async function saveAlertToSiemConfig(body: AlertToSiemConfigInput) {
  return apiFetch<AlertToSiemConfigPublic>("/v1/alert-siem/config", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function testAlertToSiemConnection() {
  return apiFetch<{ ok: boolean; message: string; http_status?: number }>("/v1/alert-siem/test", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchAlertToSiemLogs(limit = 100) {
  return apiFetch<AlertSiemForwardLog[]>(`/v1/alert-siem/logs?limit=${limit}`);
}

/** Parse comma/newline separated UUID list for rule filters. */
export function parseRuleIdList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f-]{36}$/.test(s));
}

export function formatRuleIdList(ids: string[]): string {
  return ids.join("\n");
}
