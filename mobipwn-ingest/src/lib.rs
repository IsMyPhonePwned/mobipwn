//! Ingest paths: Android bugreport, iOS sysdiagnose, NDJSON timeline upload, Vector/VRL HTTP.

mod clickhouse_insert;
mod endpoint_zip;
mod timeline;
#[cfg(not(target_arch = "wasm32"))]
mod anonymize;
#[cfg(not(target_arch = "wasm32"))]
mod bugreport_report;
#[cfg(not(target_arch = "wasm32"))]
mod magpie;
#[cfg(not(target_arch = "wasm32"))]
mod extractors;
#[cfg(not(target_arch = "wasm32"))]
mod ios_logarchive_decode;
#[cfg(not(target_arch = "wasm32"))]
mod sysdiagnose_flatten;
#[cfg(not(target_arch = "wasm32"))]
mod sysdiagnose_report;

pub use clickhouse_insert::{insert_events, insert_events_with_progress};
pub use endpoint_zip::{
    device_id_from_path, ingest_endpoint_zip_jsonl, parse_endpoint_zip, EndpointZipFile,
    EndpointZipParseResult,
};
pub use mobipwn_core::endpoint_ingest::EndpointZipDeviceRule;
pub use timeline::ingest_jsonl;

#[cfg(not(target_arch = "wasm32"))]
pub use anonymize::{anonymize_archive_file, AnonymizeIngestOptions};
#[cfg(not(target_arch = "wasm32"))]
pub use bugreport_report::{BugreportParseReport, ParserRunSummary};
#[cfg(not(target_arch = "wasm32"))]
pub use magpie::{ingest_magpie_from_archive, MagpieIngestSummary};
#[cfg(not(target_arch = "wasm32"))]
pub use extractors::{
    ingest_android_bugreport, ingest_ios_sysdiagnose, parse_android_bugreport,
    parse_ios_sysdiagnose, sysdiagnose_archive_options_from_config,
    sysdiagnose_parse_options_from_config,
};
#[cfg(not(target_arch = "wasm32"))]
pub use sysdiagnose_report::{SysdiagnoseParseReport, SysdiagnoseProgressFn};

/// Cargo features enabled in this ingest build (e.g. `logarchive-decode`).
pub fn ingest_build_features() -> &'static [&'static str] {
    &[
        #[cfg(feature = "logarchive-decode")]
        "logarchive-decode",
    ]
}
