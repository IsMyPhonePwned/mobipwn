use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// One normalized mobile event ready for ClickHouse insert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MudmEvent {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub message: String,
    pub source_type: String,
    pub source: String,
    pub platform: String,
    pub device_id: String,
    pub device_model: String,
    pub os_version: String,
    pub bundle_id: String,
    pub app_name: String,
    pub parser: String,
    pub data_type: String,
    pub event_time_binding: String,
    pub process_name: String,
    pub process_id: u32,
    pub user: String,
    pub src_ip: String,
    pub dest_ip: String,
    pub ssid: String,
    pub permission: String,
    pub file_hash: String,
    pub severity: String,
    pub action: String,
    /// Parser-specific and unmapped fields (JSON object string in CH).
    pub ext: Value,
}

impl MudmEvent {
    pub fn new(timestamp: DateTime<Utc>, message: impl Into<String>) -> Self {
        Self {
            id: Uuid::now_v7(),
            timestamp,
            message: message.into(),
            source_type: String::new(),
            source: String::new(),
            platform: String::new(),
            device_id: String::new(),
            device_model: String::new(),
            os_version: String::new(),
            bundle_id: String::new(),
            app_name: String::new(),
            parser: String::new(),
            data_type: String::new(),
            event_time_binding: String::new(),
            process_name: String::new(),
            process_id: 0,
            user: String::new(),
            src_ip: String::new(),
            dest_ip: String::new(),
            ssid: String::new(),
            permission: String::new(),
            file_hash: String::new(),
            severity: "info".into(),
            action: String::new(),
            ext: Value::Object(Default::default()),
        }
    }
}
