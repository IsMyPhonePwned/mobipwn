/** Offline fallback — keep in sync with mobipwn-core/src/mudm/fields.rs */
export type MudmFieldEntry = {
  name: string;
  category: string;
  description: string;
  storage: "column" | "ext";
  column: string | null;
};

function col(
  name: string,
  category: string,
  description: string,
  column: string
): MudmFieldEntry {
  return { name, category, description, storage: "column", column };
}

function ext(name: string, category: string, description: string): MudmFieldEntry {
  return { name, category, description, storage: "ext", column: null };
}

export const MUDM_FIELD_CATALOG: MudmFieldEntry[] = [
  col("message", "system", "Human-readable event text", "message"),
  col("timestamp", "system", "Event time UTC", "timestamp"),
  col("source_type", "system", "android_bugreport | ios_sysdiagnose | vector", "source_type"),
  col("source", "system", "Ingest label / case id (e.g. case-001)", "source"),
  col("platform", "mobile", "android | ios | endpoint", "platform"),
  col("device_id", "mobile", "Stable device identifier", "device_id"),
  col("device_model", "mobile", "Hardware model", "device_model"),
  col("os_version", "mobile", "OS build / version", "os_version"),
  col("bundle_id", "mobile", "iOS bundle or Android package", "bundle_id"),
  col("app_name", "mobile", "Display name", "app_name"),
  col("parser", "mobile", "Extractor parser module id", "parser"),
  col("data_type", "system", "Timeline data_type", "data_type"),
  col("event_time_binding", "mobile", "per_record | snapshot_only | system_fallback", "event_time_binding"),
  col("process_name", "process", "Process / command", "process_name"),
  col("process_id", "process", "PID", "process_id"),
  col("user", "authentication", "Unix-style user", "user"),
  col("src_ip", "network", "Source IP", "src_ip"),
  col("dest_ip", "network", "Destination IP", "dest_ip"),
  ext("local_port", "network", "Local socket port (ext, Network parser)"),
  ext("remote_port", "network", "Remote socket port (ext, Network parser)"),
  col("ssid", "network", "Wi-Fi SSID", "ssid"),
  col("permission", "mobile", "Android permission or iOS TCC", "permission"),
  col("file_hash", "malware", "File hash if present", "file_hash"),
  col("severity", "system", "info | low | medium | high", "severity"),
  col("action", "system", "Normalized action", "action"),
  ext("installer", "mobile", "Installing package (ext / package install log), e.g. com.android.vending"),
  ext("event_type", "system", "Sigma/timeline event type (e.g. network_socket, tombstone_backtrace) in ext"),
  ext("destination_domain", "network", "Remote hostname from sockets (ext)"),
  ext("remote_ip", "network", "Remote IP (ext)"),
  ext("function", "process", "Crash backtrace symbol (ext)"),
  ext("file_path", "malware", "Path / filename IoC (ext)"),
  ext("email", "authentication", "Email IoC (ext)"),
  col("ingest_time", "system", "Wall-clock time the event was inserted into ClickHouse", "ingest_time"),
  col("ext", "system", "Raw parser-specific JSON blob; use named ext fields in mPL (e.g. destination_domain)", "ext"),
];
