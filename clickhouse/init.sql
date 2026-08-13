-- mobipwn ClickHouse schema (nano-inspired: daily partitions, 90-day TTL)

CREATE DATABASE IF NOT EXISTS mobipwn;

CREATE TABLE IF NOT EXISTS mobipwn.events
(
    `id` UUID DEFAULT generateUUIDv7(),
    `timestamp` DateTime64(6, 'UTC'),
    `message` String,
    `source_type` LowCardinality(String) DEFAULT '',
    `source` LowCardinality(String) DEFAULT '',
    `ingest_time` DateTime64(6, 'UTC') DEFAULT now64(6),
    `platform` LowCardinality(String) DEFAULT '',
    `device_id` String DEFAULT '',
    `device_model` LowCardinality(String) DEFAULT '',
    `os_version` LowCardinality(String) DEFAULT '',
    `bundle_id` String DEFAULT '',
    `app_name` LowCardinality(String) DEFAULT '',
    `parser` LowCardinality(String) DEFAULT '',
    `data_type` LowCardinality(String) DEFAULT '',
    `event_time_binding` LowCardinality(String) DEFAULT '',
    `process_name` LowCardinality(String) DEFAULT '',
    `process_id` UInt32 DEFAULT 0,
    `user` LowCardinality(String) DEFAULT '',
    `src_ip` String DEFAULT '',
    `dest_ip` String DEFAULT '',
    `ssid` String DEFAULT '',
    `permission` String DEFAULT '',
    `file_hash` String DEFAULT '',
    `severity` LowCardinality(String) DEFAULT 'info',
    `action` LowCardinality(String) DEFAULT '',
    `ext` String DEFAULT '{}',
    INDEX idx_message_tokens message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_bundle bundle_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_parser parser TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (platform, timestamp, id)
SETTINGS index_granularity = 8192;

-- Real-time detection path: materialized view over recent inserts
CREATE TABLE IF NOT EXISTS mobipwn.detection_signals
(
    `rule_id` UUID,
    `rule_name` String,
    `matched_at` DateTime64(6, 'UTC') DEFAULT now64(6),
    `event_id` UUID,
    `platform` LowCardinality(String),
    `dedup_key` String,
    `prevalence` Float64 DEFAULT 0,
    `payload` String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(matched_at)
ORDER BY (rule_id, matched_at)
TTL toDateTime(matched_at) + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mobipwn.mv_high_severity_events
TO mobipwn.detection_signals
AS
SELECT
    toUUID('00000000-0000-0000-0000-000000000001') AS rule_id,
    'builtin_high_severity' AS rule_name,
    now64(6) AS matched_at,
    id AS event_id,
    platform,
    concat(platform, ':', bundle_id, ':', parser) AS dedup_key,
    0.0 AS prevalence,
    message AS payload
FROM mobipwn.events
WHERE severity IN ('high', 'critical');

-- Prevalence sidebar support
CREATE TABLE IF NOT EXISTS mobipwn.field_prevalence_agg
(
    `field` LowCardinality(String),
    `value` String,
    `bucket_day` Date,
    `event_count` SimpleAggregateFunction(sum, UInt64),
    `device_count` SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(bucket_day)
ORDER BY (field, value, bucket_day)
TTL bucket_day + INTERVAL 90 DAY;

-- Marketplace enrichment tables (dictionaries created by scripts/ch-migrate.sh with credentials)

CREATE TABLE IF NOT EXISTS mobipwn.ip_enrichments
(
    `ip` String,
    `country` LowCardinality(String) DEFAULT '',
    `city` String DEFAULT '',
    `asn` String DEFAULT '',
    `updated_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY ip;

CREATE TABLE IF NOT EXISTS mobipwn.ioc_enrichments
(
    `indicator` String,
    `indicator_type` LowCardinality(String),
    `malware_family` String DEFAULT '',
    `score` Float32 DEFAULT 0,
    `vt_malicious` UInt16 DEFAULT 0,
    `vt_harmless` UInt16 DEFAULT 0,
    `vt_undetected` UInt16 DEFAULT 0,
    `vt_suspicious` UInt16 DEFAULT 0,
    `vt_reputation` Int32 DEFAULT 0,
    `updated_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (indicator_type, indicator);

CREATE TABLE IF NOT EXISTS mobipwn.custom_enrichment_results
(
    `field` LowCardinality(String),
    `value` String,
    `enrichment_key` LowCardinality(String) DEFAULT '',
    `enrichment_value` String DEFAULT '',
    `indicator_type` LowCardinality(String) DEFAULT '',
    `malware_family` String DEFAULT '',
    `score` Float32 DEFAULT 0,
    `updated_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (field, value, enrichment_key, indicator_type);

CREATE TABLE IF NOT EXISTS mobipwn.asset_enrichments
(
    `device_id` String,
    `device_model` String DEFAULT '',
    `owner` String DEFAULT '',
    `tags` Array(String) DEFAULT [],
    `updated_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY device_id;

CREATE TABLE IF NOT EXISTS mobipwn.package_enrichments
(
    `package_id` String,
    `on_play_store` UInt8 DEFAULT 0,
    `play_store_url` String DEFAULT '',
    `app_title` String DEFAULT '',
    `updated_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY package_id;
