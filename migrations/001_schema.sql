-- mobipwn PostgreSQL schema (single fresh-install migration)
-- Apply via sqlx on API/jobs startup. Wipe volumes for a clean DB — do not layer
-- incremental migrations on top of this file for greenfield installs.
--
-- Enum notes:
--   alert_status: new | triaged | verified | false_positive
--   rule_lifecycle: staging | live | alerting
--   detection_mode: scheduled | realtime
--   provider_kind: threat_intel | identity | asset_inventory | geolocation
--   api_role: admin | analyst | viewer
--   case_status: open | investigating | closed
--   ironsift_run_mode: fleet | temporal | file | both | anomark
--   ironsift_run_scope: fleet | case | device
--   ironsift_run_status: pending | running | done | failed | skipped
--   ironsift_triage_verdict: unset | false_positive | malicious
--
-- Constraint notes:
--   cases.ingest_source: partial UNIQUE index (non-null values only)
--   rule_folders: UNIQUE (repository_id, COALESCE(parent_id, zero-uuid), name)
--   ingest_jobs: UNIQUE (source, file_hash)
--   alerts: UNIQUE (rule_id, dedup_key)
--   collect_blobs.analyzed: defaults TRUE; device-pull blobs set FALSE at insert time

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

CREATE TYPE alert_status AS ENUM ('new', 'triaged', 'verified', 'false_positive');
CREATE TYPE rule_lifecycle AS ENUM ('staging', 'live', 'alerting');
CREATE TYPE detection_mode AS ENUM ('scheduled', 'realtime');
CREATE TYPE provider_kind AS ENUM ('threat_intel', 'identity', 'asset_inventory', 'geolocation');
CREATE TYPE api_role AS ENUM ('admin', 'analyst', 'viewer');
CREATE TYPE case_status AS ENUM ('open', 'investigating', 'closed');
CREATE TYPE ironsift_run_mode AS ENUM ('fleet', 'temporal', 'file', 'both', 'anomark');
CREATE TYPE ironsift_run_scope AS ENUM ('fleet', 'case', 'device');
CREATE TYPE ironsift_run_status AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');
CREATE TYPE ironsift_triage_verdict AS ENUM ('unset', 'false_positive', 'malicious');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE rule_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rule_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES rule_repositories(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES rule_folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_rule_folders_unique_name
    ON rule_folders (repository_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE TABLE detection_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    lifecycle rule_lifecycle NOT NULL DEFAULT 'live',
    mode detection_mode NOT NULL DEFAULT 'scheduled',
    query TEXT NOT NULL,
    cron TEXT,
    severity TEXT NOT NULL DEFAULT 'medium',
    mitre TEXT[] NOT NULL DEFAULT '{}',
    prevalence_threshold DOUBLE PRECISION,
    signal_log_enabled BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    last_run_at TIMESTAMPTZ,
    last_hit_count INT NOT NULL DEFAULT 0,
    min_hits INT NOT NULL DEFAULT 1,
    max_alerts_per_run INT NOT NULL DEFAULT 50,
    muted_until TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sigma_yaml TEXT,
    realtime_mv TEXT,
    repository_id UUID REFERENCES rule_repositories(id) ON DELETE SET NULL,
    folder_id UUID REFERENCES rule_folders(id) ON DELETE SET NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    maintainer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rules_lifecycle ON detection_rules(lifecycle);
CREATE INDEX idx_detection_rules_repository ON detection_rules(repository_id);
CREATE INDEX idx_detection_rules_folder ON detection_rules(folder_id);
CREATE INDEX idx_detection_rules_tags ON detection_rules USING GIN(tags);
CREATE INDEX idx_detection_rules_maintainer ON detection_rules(maintainer) WHERE maintainer IS NOT NULL;

CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status case_status NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    case_user TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    ingest_source TEXT,
    primary_anchor_type TEXT,
    primary_anchor_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_cases_ingest_source ON cases (ingest_source) WHERE ingest_source IS NOT NULL;
CREATE INDEX idx_cases_status ON cases(status, updated_at DESC);
CREATE INDEX idx_cases_case_user ON cases (case_user);

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES detection_rules(id) ON DELETE CASCADE,
    status alert_status NOT NULL DEFAULT 'new',
    dedup_key TEXT NOT NULL,
    group_id UUID,
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_count INT NOT NULL DEFAULT 1,
    sample_event_id UUID,
    assignee TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
    context JSONB NOT NULL DEFAULT '{}',
    dismissed_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolution_count INT NOT NULL DEFAULT 0,
    UNIQUE (rule_id, dedup_key)
);

CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_case ON alerts(case_id);
CREATE INDEX idx_alerts_context_source ON alerts ((context->>'source'));
CREATE INDEX idx_alerts_dismissed_at ON alerts (dismissed_at) WHERE dismissed_at IS NOT NULL;

-- Audit log for alerts forwarded to external SIEM (Splunk HEC, etc.)
CREATE TABLE alert_siem_forward_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
    event_kind TEXT NOT NULL DEFAULT 'detection',
    destination TEXT NOT NULL,
    siem_type TEXT NOT NULL DEFAULT 'splunk_hec',
    status TEXT NOT NULL,
    http_status INT,
    error_message TEXT,
    payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_siem_forward_log_created
    ON alert_siem_forward_log (created_at DESC);

CREATE INDEX idx_alert_siem_forward_log_alert
    ON alert_siem_forward_log (alert_id)
    WHERE alert_id IS NOT NULL;

CREATE TABLE alert_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES detection_rules(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    alert_count INT NOT NULL DEFAULT 0,
    status alert_status NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrichment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind provider_kind NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    covers_fields TEXT[] NOT NULL DEFAULT '{}',
    config JSONB NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_error TEXT,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingest_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL,
    platform TEXT NOT NULL,
    path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sources explicitly removed via case/data delete — skip auto-registration until re-ingest.
CREATE TABLE ingest_source_tombstones (
    source TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_query_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES saved_query_folders(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_query_folders_parent ON saved_query_folders(parent_id);

CREATE TABLE saved_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    query TEXT NOT NULL,
    folder_id UUID REFERENCES saved_query_folders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_queries_name ON saved_queries(name);
CREATE INDEX idx_saved_queries_folder ON saved_queries(folder_id);

CREATE TABLE detection_rule_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES detection_rules(id) ON DELETE CASCADE,
    version INT NOT NULL,
    query TEXT NOT NULL,
    query_before TEXT,
    author TEXT NOT NULL DEFAULT 'system',
    mitre TEXT[] NOT NULL DEFAULT '{}',
    diff TEXT,
    sigma_yaml TEXT,
    lifecycle TEXT,
    mode TEXT,
    severity TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rule_versions_rule ON detection_rule_versions(rule_id, version DESC);

CREATE TABLE detection_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES detection_rules(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    hit_count INT NOT NULL DEFAULT 0,
    alerts_created INT NOT NULL DEFAULT 0,
    error TEXT
);

CREATE INDEX idx_detection_runs_rule ON detection_runs(rule_id, started_at DESC);

CREATE TABLE ingest_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    platform TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    events_count INT NOT NULL DEFAULT 0,
    error TEXT,
    archive_path TEXT,
    file_size BIGINT NOT NULL DEFAULT 0,
    bytes_received BIGINT NOT NULL DEFAULT 0,
    case_user TEXT,
    ingest_tags TEXT[] NOT NULL DEFAULT '{}',
    stage TEXT NOT NULL DEFAULT '',
    stage_detail TEXT NOT NULL DEFAULT '',
    progress_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (source, file_hash)
);

CREATE INDEX idx_ingest_jobs_status ON ingest_jobs(status);

CREATE TABLE collect_blobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingest_job_id UUID REFERENCES ingest_jobs(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    platform TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    case_user TEXT,
    ingest_tags TEXT[] NOT NULL DEFAULT '{}',
    origin TEXT NOT NULL DEFAULT 'collect',
    analyzed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX collect_blobs_source_created_idx ON collect_blobs (source, created_at DESC);
CREATE INDEX collect_blobs_created_idx ON collect_blobs (created_at DESC);

CREATE TABLE alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'comment',
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'analyst',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_events_alert ON alert_events(alert_id, created_at DESC);

CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'webhook',
    url TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppression_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    rule_id UUID REFERENCES detection_rules(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE search_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    row_count INT NOT NULL DEFAULT 0,
    elapsed_ms INT NOT NULL DEFAULT 0,
    api_key_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role api_role NOT NULL DEFAULT 'admin',
    totp_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT false,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    role api_role NOT NULL DEFAULT 'analyst',
    description TEXT NOT NULL DEFAULT '',
    last_used_at TIMESTAMPTZ,
    last_used_ip TEXT,
    request_count BIGINT NOT NULL DEFAULT 0,
    response_bytes BIGINT NOT NULL DEFAULT 0,
    suspended_at TIMESTAMPTZ,
    key_ciphertext TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_active ON api_keys (created_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_user ON api_keys (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_user_active ON api_keys (user_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE siem_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    query_mode TEXT NOT NULL DEFAULT 'piped',
    time_range_type TEXT NOT NULL DEFAULT 'preset',
    time_range_preset TEXT,
    time_range_start TIMESTAMPTZ,
    time_range_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_history_created ON search_history(created_at DESC);

CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Default',
    layout JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    mfa_verified BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_auth_sessions_active ON auth_sessions (expires_at DESC) WHERE mfa_verified = true;

CREATE TABLE auth_mfa_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_mfa_expires ON auth_mfa_challenges(expires_at);

CREATE TABLE ironsift_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode ironsift_run_mode NOT NULL,
    scope ironsift_run_scope NOT NULL,
    scope_filter JSONB NOT NULL DEFAULT '{}',
    config_json JSONB NOT NULL DEFAULT '{}',
    status ironsift_run_status NOT NULL DEFAULT 'pending',
    fleet_size INT NOT NULL DEFAULT 0,
    anomaly_count INT NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    error TEXT,
    report_json JSONB,
    ironsift_config_name TEXT,
    anomark_config_name TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    triggered_by TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX ironsift_runs_started_at_idx ON ironsift_runs (started_at DESC);

CREATE TABLE ironsift_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES ironsift_runs(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    detector TEXT NOT NULL,
    severity TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    distance_score DOUBLE PRECISION,
    reasons TEXT[] NOT NULL DEFAULT '{}',
    cluster_id TEXT,
    alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
    raw_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ironsift_findings_run_id_idx ON ironsift_findings (run_id);
CREATE INDEX ironsift_findings_machine_id_idx ON ironsift_findings (machine_id);

CREATE TABLE ironsift_triage (
    run_id UUID NOT NULL REFERENCES ironsift_runs(id) ON DELETE CASCADE,
    finding_id UUID NOT NULL REFERENCES ironsift_findings(id) ON DELETE CASCADE,
    detector TEXT NOT NULL,
    reason TEXT NOT NULL,
    verdict ironsift_triage_verdict NOT NULL DEFAULT 'unset',
    alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
    actor_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, finding_id, detector, reason)
);

CREATE INDEX ironsift_triage_alert_id_idx ON ironsift_triage (alert_id) WHERE alert_id IS NOT NULL;

CREATE TABLE ironsift_run_devices (
    run_id UUID NOT NULL REFERENCES ironsift_runs(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    device_id TEXT,
    source TEXT,
    case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
    PRIMARY KEY (run_id, machine_id)
);

CREATE TABLE ironsift_anomark_trains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL DEFAULT '',
    scope_filter JSONB NOT NULL DEFAULT '{}',
    request_json JSONB NOT NULL DEFAULT '{}',
    training_line_count BIGINT NOT NULL DEFAULT 0,
    rel_model_path TEXT NOT NULL,
    rel_training_path TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX ironsift_anomark_trains_created_at_idx ON ironsift_anomark_trains (created_at DESC);

CREATE TABLE alert_deletion_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_by TEXT NOT NULL DEFAULT 'analyst',
    reason TEXT,
    batch_id UUID,
    alert_snapshot JSONB NOT NULL,
    events_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX idx_alert_deletion_audit_alert ON alert_deletion_audit(alert_id);
CREATE INDEX idx_alert_deletion_audit_deleted_at ON alert_deletion_audit(deleted_at DESC);
CREATE INDEX idx_alert_deletion_audit_batch ON alert_deletion_audit(batch_id) WHERE batch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

INSERT INTO enrichment_providers (slug, name, kind, enabled, covers_fields, config)
VALUES
    ('geo_lite', 'GeoLite (geolocation)', 'geolocation', false, ARRAY['src_ip', 'dest_ip'], '{}'),
    ('threatfox', 'ThreatFox IOC', 'threat_intel', false, ARRAY['file_hash'], '{}'),
    ('device_inventory', 'Device inventory', 'asset_inventory', false, ARRAY['device_id', 'device_model'], '{}'),
    ('mobile_identity', 'Mobile identity', 'identity', false, ARRAY['user', 'bundle_id'], '{}'),
    ('virustotal', 'VirusTotal', 'threat_intel', false, ARRAY['src_ip', 'dest_ip', 'destination_domain', 'file_hash'], '{}'),
    ('google_play', 'Google Play', 'asset_inventory', false, ARRAY['bundle_id'], '{}');

INSERT INTO siem_settings (key, value) VALUES
    ('retention_by_source_type', '{}'),
    ('search_limits', '{
      "max_concurrent": 4,
      "max_limit": 10000,
      "max_export_limit": 50000,
      "max_query_len": 8192,
      "require_time_range": true,
      "default_hours": 24,
      "max_joins": 2,
      "max_execution_time_secs": 60,
      "events_ttl_days": 90
    }'),
    ('search_history', '{"enabled": true}'),
    ('pivt', '{"enabled": false, "model": "gpt-4o-mini"}'),
    ('ironsift_config', '{
      "enabled": true,
      "fleet_cron": "0 0 3 * * *",
      "post_ingest_temporal": true,
      "min_fleet_devices": 3,
      "min_score": 0.4,
      "mudm_platform": "endpoint",
      "detection_config": {}
    }'),
    ('llm_config', '{"api_url":"","api_key":"","model":""}'),
    ('mcp_config', '{"auto_start":true,"api_url":"http://127.0.0.1:3000","api_key":"","binary_path":""}'),
    ('sysdiagnose_ingest', '{"logarchive_decode_max_lines":2500,"ioservice_full_tree":false,"logarchive_uncapped":false,"max_entry_mb":64}');

INSERT INTO dashboards (name, layout, is_default)
VALUES (
    'Overview',
    '[
      {"i":"events_24h","x":0,"y":0,"w":3,"h":2,"minW":2,"minH":2},
      {"i":"alerts_new","x":3,"y":0,"w":3,"h":2,"minW":2,"minH":2},
      {"i":"rules","x":6,"y":0,"w":3,"h":2,"minW":2,"minH":2},
      {"i":"hunt","x":9,"y":0,"w":3,"h":2,"minW":2,"minH":2}
    ]'::jsonb,
    true
);

INSERT INTO rule_repositories (id, name, description, sort_order)
VALUES (
    '11111111-1111-1111-1111-111111111101'::uuid,
    'Default',
    'Primary detection rule library',
    0
);

INSERT INTO rule_folders (id, repository_id, parent_id, name, sort_order) VALUES
    ('11111111-1111-1111-1111-111111111201'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'Uncategorized', 0),
    ('11111111-1111-1111-1111-111111111202'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'Amnesty', 1),
    ('11111111-1111-1111-1111-111111111204'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'CVE', 2),
    ('11111111-1111-1111-1111-111111111205'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111204'::uuid, 'Android', 0),
    ('11111111-1111-1111-1111-111111111206'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111204'::uuid, 'iOS', 1),
    ('11111111-1111-1111-1111-111111111203'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'Mobile hunts', 3),
    ('11111111-1111-1111-1111-111111111207'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'Threat Intel', 4),
    ('11111111-1111-1111-1111-111111111208'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111207'::uuid, 'DarkSword', 0),
    ('11111111-1111-1111-1111-111111111209'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111207'::uuid, 'MVT / Spyrtacus', 1);

INSERT INTO saved_query_folders (name, sort_order)
VALUES ('Mobile hunts', 0);

-- Amnesty investigation rules + product defaults (live lifecycle)
INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - NSO Group Infrastructure (2018-08-01)', 'IoCs from NSO Group infrastructure. Full list at https://github.com/AmnestyTech/investigations/tree/master/2018-08-01_nso (id: amnesty-inv-2018-08-01-nso)', 'live', 'scheduled', '(((destination_domain="14-tracking.com" OR dest_ip="14-tracking.com" OR message=*14-tracking.com*) OR (destination_domain="1minto-start.com" OR dest_ip="1minto-start.com" OR message=*1minto-start.com*) OR (destination_domain="24-7clinic.com" OR dest_ip="24-7clinic.com" OR message=*24-7clinic.com*) OR (destination_domain="accountnotify.com" OR dest_ip="accountnotify.com" OR message=*accountnotify.com*) OR (destination_domain="egov-sergek.info" OR dest_ip="egov-sergek.info" OR message=*egov-sergek.info*) OR (destination_domain="domainsearching.net" OR dest_ip="domainsearching.net" OR message=*domainsearching.net*) OR (destination_domain="ehistorybooks.com" OR dest_ip="ehistorybooks.com" OR message=*ehistorybooks.com*) OR (destination_domain="findmyass.org" OR dest_ip="findmyass.org" OR message=*findmyass.org*) OR (destination_domain="legyelvodas.com" OR dest_ip="legyelvodas.com" OR message=*legyelvodas.com*) OR (destination_domain="pastesbin.com" OR dest_ip="pastesbin.com" OR message=*pastesbin.com*) OR (destination_domain="shia-voice.com" OR dest_ip="shia-voice.com" OR message=*shia-voice.com*) OR (destination_domain="so-this-is.com" OR dest_ip="so-this-is.com" OR message=*so-this-is.com*) OR (destination_domain="stopmysms.com" OR dest_ip="stopmysms.com" OR message=*stopmysms.com*)) OR data_type=*network_socket* AND (dest_ip="191.101.31.25" OR dest_ip="185.94.190.203" OR dest_ip="46.183.219.79" OR dest_ip="185.130.184.35" OR dest_ip="185.195.200.47" OR dest_ip="159.89.193.231")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - NSO Group Infrastructure (2018-08-01)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Phishing Best Practice Domains (2018-12-19)', 'Fake account/login/phishing domains. Full list at https://github.com/AmnestyTech/investigations/tree/master/2018-12-19_best_practice (id: amnesty-inv-2018-12-19-best-practice)', 'live', 'scheduled', '(((destination_domain="account-facebook.com" OR dest_ip="account-facebook.com" OR message=*account-facebook.com*) OR (destination_domain="account-privacy.com" OR dest_ip="account-privacy.com" OR message=*account-privacy.com*) OR (destination_domain="accounts-settings.com" OR dest_ip="accounts-settings.com" OR message=*accounts-settings.com*) OR (destination_domain="connect-myaccount.com" OR dest_ip="connect-myaccount.com" OR message=*connect-myaccount.com*) OR (destination_domain="inbox101-live.com" OR dest_ip="inbox101-live.com" OR message=*inbox101-live.com*) OR (destination_domain="mail02-inbox.com" OR dest_ip="mail02-inbox.com" OR message=*mail02-inbox.com*) OR (destination_domain="myaccount-logins.com" OR dest_ip="myaccount-logins.com" OR message=*myaccount-logins.com*) OR (destination_domain="myaccount.verification-approve.com" OR dest_ip="myaccount.verification-approve.com" OR message=*myaccount.verification-approve.com*) OR (destination_domain="noreply-myaccount.com" OR dest_ip="noreply-myaccount.com" OR message=*noreply-myaccount.com*) OR (destination_domain="verification-approve.com" OR dest_ip="verification-approve.com" OR message=*verification-approve.com*) OR (destination_domain="truecaller.services" OR dest_ip="truecaller.services" OR message=*truecaller.services*) OR (destination_domain="tutanota.org" OR dest_ip="tutanota.org" OR message=*tutanota.org*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Phishing Best Practice Domains (2018-12-19)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Egypt OAuth Abuse (2019-03-06)', 'Egypt OAuth phishing/credential theft domains. Full list at https://github.com/AmnestyTech/investigations/tree/master/2019-03-06_egypt_oauth (id: amnesty-inv-2019-03-06-egypt-oauth)', 'live', 'scheduled', '(((destination_domain="account-login.site" OR dest_ip="account-login.site" OR message=*account-login.site*) OR (destination_domain="login-service.email" OR dest_ip="login-service.email" OR message=*login-service.email*) OR (destination_domain="mail-secure.online" OR dest_ip="mail-secure.online" OR message=*mail-secure.online*) OR (destination_domain="mail-verify.live" OR dest_ip="mail-verify.live" OR message=*mail-verify.live*) OR (destination_domain="secure-accounts.online" OR dest_ip="secure-accounts.online" OR message=*secure-accounts.online*) OR (destination_domain="signin-aouth2.pw" OR dest_ip="signin-aouth2.pw" OR message=*signin-aouth2.pw*) OR (destination_domain="verify-mail.pro" OR dest_ip="verify-mail.pro" OR message=*verify-mail.pro*) OR (destination_domain="verifymail.live" OR dest_ip="verifymail.live" OR message=*verifymail.live*) OR (destination_domain="www.secure-email.site" OR dest_ip="www.secure-email.site" OR message=*www.secure-email.site*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Egypt OAuth Abuse (2019-03-06)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Evolving Phishing (2019-08-16)', 'Evolving phishing campaign domains and emails. Populate from domains.txt and emails.txt at https://github.com/AmnestyTech/investigations/tree/master/2019-08-16_evolving_phishing (id: amnesty-inv-2019-08-16-evolving-phishing)', 'live', 'scheduled', '(((destination_domain="srf-google.site" OR dest_ip="srf-google.site" OR message=*srf-google.site*) OR (destination_domain="gmailusercontent.site" OR dest_ip="gmailusercontent.site" OR message=*gmailusercontent.site*) OR (destination_domain="protect-outlook.com" OR dest_ip="protect-outlook.com" OR message=*protect-outlook.com*)) OR (email="admin@microsoftstore.com" OR email="noreply@gmailusercontent.site" OR email="noreply@mailgoogle.ccm" OR email="googlecommunityteam-noreply@srf-google.site" OR email="noreply-accounts@google.cm" OR email="noreply@accounts-google.com" OR email="noreply@accounts-googleemail.site" OR email="accounts-noreply@google.ccm" OR email="alerts@valabs.info" OR email="google@noreply-accounts.com" OR email="no-reply@google.email")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Evolving Phishing (2019-08-16)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - NSO Morocco (2019-10-10)', 'NSO-related Morocco campaign domains. Full list at https://github.com/AmnestyTech/investigations/tree/master/2019-10-10_nso_morocco (id: amnesty-inv-2019-10-10-nso-morocco)', 'live', 'scheduled', '(((destination_domain="stopsms.biz" OR dest_ip="stopsms.biz" OR message=*stopsms.biz*) OR (destination_domain="revolution-news.co" OR dest_ip="revolution-news.co" OR message=*revolution-news.co*) OR (destination_domain="videosdownload.co" OR dest_ip="videosdownload.co" OR message=*videosdownload.co*) OR (destination_domain="infospress.com" OR dest_ip="infospress.com" OR message=*infospress.com*) OR (destination_domain="business-today.info" OR dest_ip="business-today.info" OR message=*business-today.info*) OR (destination_domain="hmizat.co" OR dest_ip="hmizat.co" OR message=*hmizat.co*) OR (destination_domain="free247downloads.com" OR dest_ip="free247downloads.com" OR message=*free247downloads.com*) OR (destination_domain="bun54l2b67.get1tn0w.free247downloads.com" OR dest_ip="bun54l2b67.get1tn0w.free247downloads.com" OR message=*bun54l2b67.get1tn0w.free247downloads.com*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - NSO Morocco (2019-10-10)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Uzbekistan Targeted Campaign (2020-03-12)', 'Uzbekistan-targeted IoCs (domains, IPs, samples). Full list at https://github.com/AmnestyTech/investigations/tree/master/2020-03-12_uzbekistan (id: amnesty-inv-2020-03-12-uzbekistan)', 'live', 'scheduled', '(((destination_domain="acccountsgoog1e.com" OR dest_ip="acccountsgoog1e.com" OR message=*acccountsgoog1e.com*) OR (destination_domain="accountsgoog1e.com" OR dest_ip="accountsgoog1e.com" OR message=*accountsgoog1e.com*) OR (destination_domain="auth-google.site" OR dest_ip="auth-google.site" OR message=*auth-google.site*) OR (destination_domain="navyfedera1.org" OR dest_ip="navyfedera1.org" OR message=*navyfedera1.org*) OR (destination_domain="mynavyfedera1.org" OR dest_ip="mynavyfedera1.org" OR message=*mynavyfedera1.org*) OR (destination_domain="yandex-account-security.com" OR dest_ip="yandex-account-security.com" OR message=*yandex-account-security.com*) OR (destination_domain="gmail-warning.top" OR dest_ip="gmail-warning.top" OR message=*gmail-warning.top*) OR (destination_domain="google-activity.pw" OR dest_ip="google-activity.pw" OR message=*google-activity.pw*)) OR (file_hash="279c70f2da2c361b62353bdaa388372adc14929b3be83571b1347d890fd6279c" OR file_hash="902c5f46ac101b6f30032d4c5c86ecec115add3605fb0d66057130b6e11c57e6" OR file_hash="ba1990b5e38191512718180d0de1ad2123e18330449b8c12877c4db60aeb05e4")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Uzbekistan Targeted Campaign (2020-03-12)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - India Targeted Campaign (2020-06-15)', 'India-targeted IoCs (domains, IPs, emails, SHA256). Full list at https://github.com/AmnestyTech/investigations/tree/master/2020-06-15_india (id: amnesty-inv-2020-06-15-india)', 'live', 'scheduled', '(((destination_domain="researchplanet.zapto.org" OR dest_ip="researchplanet.zapto.org" OR message=*researchplanet.zapto.org*) OR (destination_domain="socialstatistics.zapto.org" OR dest_ip="socialstatistics.zapto.org" OR message=*socialstatistics.zapto.org*) OR (destination_domain="duniaenewsportal.ddns.net" OR dest_ip="duniaenewsportal.ddns.net" OR message=*duniaenewsportal.ddns.net*)) OR data_type=*network_socket* AND (dest_ip="185.82.202.155" OR dest_ip="185.117.66.188" OR dest_ip="185.117.74.47" OR dest_ip="185.117.74.28" OR dest_ip="185.45.193.14") OR (email="jagdish.meshraamu@gmail.com" OR email="drsnehapatil64@gmail.com" OR email="sinhamuskaan04@gmail.com" OR email="jennifergonzales789@gmail.com" OR email="payalshastri79@gmail.com") OR (file_hash="e3dea449bf74434ee1c9cdc04ca68b8f3c9bac357768e07df303433f257d3b9a" OR file_hash="21d24e08889f75461a7ce6f21fc612a701bca35da1a218cf3cdd6e23f613bb4d" OR file_hash="16b5c74fb55f52ae0ae4328f65b2bf3bbe3e5ee34268c1d32a247a0a1dfa3186" OR file_hash="5a4aca57541954195953066a4be96dfb19776ba099d72f8f1d3677581594606e" OR file_hash="11cef331557eb693e718d27b6a7211a98d3982117a03ec1491db8098ea3cec00" OR file_hash="88b92d985b7d616c93c391731c1e4a6d3c8323fdcbf31cfc4d340e27253913a7" OR file_hash="b1b6e133aa320669c772ec7e5fd6fbe4cb3edca13ad5351f14df3c1f13939d09" OR file_hash="ea5f37e1feab670171963aa83b235c772202b2d4bb7289dd45302c3851dbd6f9" OR file_hash="de302a61e5f07b0e65753355d44d22181a2742ac3a92aa058bdcd00cc4dab788" OR file_hash="b09ca9d48a0455ed5e02a56aabeb397c41fb63320244719749e0741da72e79c4" OR file_hash="095ec879f323a0a3eceb97013125880d49ac701eef568e3b010fdddb1333941f" OR file_hash="ac4d5d938009fd44b2f7587986862ab2278887a17d32f748278445b625b3efd9")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - India Targeted Campaign (2020-06-15)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - FinFisher Spyware (2020-09-25)', 'FinFisher spyware IoCs (domains, IPs, SHA256). Full list at https://github.com/AmnestyTech/investigations/tree/master/2020-09-25_finfisher (id: amnesty-inv-2020-09-25-finfisher)', 'live', 'scheduled', '(((destination_domain="flash.browserupdate.download" OR dest_ip="flash.browserupdate.download" OR message=*flash.browserupdate.download*) OR (destination_domain="current.browserupdate.download" OR dest_ip="current.browserupdate.download" OR message=*current.browserupdate.download*) OR (destination_domain="files.browserupdate.download" OR dest_ip="files.browserupdate.download" OR message=*files.browserupdate.download*) OR (destination_domain="browserupdate.download" OR dest_ip="browserupdate.download" OR message=*browserupdate.download*)) OR (file_hash="1e9162cd0941557304a6a097dfaadf59f90bc8bbaa9879afe67b5ce0d1514be8" OR file_hash="854774a198db490a1ae9f06d5da5fe6a1f683bf3d7186e56776516f982d41ad3" OR file_hash="bb8c0e477512adab1db26eb77fe10dadbc5dcbf8e94569061c7199ca4626a420" OR file_hash="80d6e71c54fb3d4a904637e4d56e108a8255036cbb4760493b142889e47b951f" OR file_hash="f960144126748b971386731d35e41288336ad72a9da0c6b942287f397d57c600" OR file_hash="fab6b3bbc14c80049f95b040680fba6d1b47f07746729d04c887a55272084648" OR file_hash="8f216d2f0be2c4a5c07abf45cf138453f72f00ec598327756c6fc9d5f4dabe0d" OR file_hash="4f3003dd2ed8dcb68133f95c14e28b168bd0f52e5ae9842f528d3f7866495cea" OR file_hash="bd1b8bc046dbf19f8c9bbf9398fdbc47c777e1d9e6d9ff1787ada05ed75c1b12" OR file_hash="9f04439bc94f2eef76b72ac2e0aeece0d4f46b6c42ef179fc860f6b5876f5f50" OR file_hash="928aefbcac9386c953b3491230a719ff65b21612eb6bd9b32501de149cacbc92" OR file_hash="14658327efaa15275fb8718956ee97ebcad5bc80312a4f3182a3b10cd3dcf257")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - FinFisher Spyware (2020-09-25)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Vietnam Targeted Campaign (2021-02-24)', 'Vietnam-targeted IoCs (domains, IPs, SHA256) from indicators subfolder. Full list at https://github.com/AmnestyTech/investigations/tree/master/2021-02-24_vietnam (id: amnesty-inv-2021-02-24-vietnam)', 'live', 'scheduled', '(((destination_domain="ssl.arkouthrie.com" OR dest_ip="ssl.arkouthrie.com" OR message=*ssl.arkouthrie.com*) OR (destination_domain="widget.shoreoa.com" OR dest_ip="widget.shoreoa.com" OR message=*widget.shoreoa.com*) OR (destination_domain="s3.hiahornber.com" OR dest_ip="s3.hiahornber.com" OR message=*s3.hiahornber.com*) OR (destination_domain="tips.jasperpfeiffer.com" OR dest_ip="tips.jasperpfeiffer.com" OR message=*tips.jasperpfeiffer.com*) OR (destination_domain="land.rellecharlessper.com" OR dest_ip="land.rellecharlessper.com" OR message=*land.rellecharlessper.com*) OR (destination_domain="art.guillermoespana.com" OR dest_ip="art.guillermoespana.com" OR message=*art.guillermoespana.com*) OR (destination_domain="api.ciscofreak.com" OR dest_ip="api.ciscofreak.com" OR message=*api.ciscofreak.com*) OR (destination_domain="node.podzone.org" OR dest_ip="node.podzone.org" OR message=*node.podzone.org*) OR (destination_domain="delicato.dnsalias.net" OR dest_ip="delicato.dnsalias.net" OR message=*delicato.dnsalias.net*) OR (destination_domain="coco.cechire.com" OR dest_ip="coco.cechire.com" OR message=*coco.cechire.com*)) OR data_type=*network_socket* AND (dest_ip="185.174.101.13" OR dest_ip="185.157.79.134" OR dest_ip="95.168.191.35" OR dest_ip="45.76.106.146" OR dest_ip="5.149.254.19" OR dest_ip="103.114.161.122") OR (file_hash="952c16674bde3c16aa3935b3e01f3f0fb4cbac7ffa130143cbf6ccaa72733068" OR file_hash="d3a198e18f8c5e9ed54ed4959b47a0f15fbda7d4abf92b7726bc07723e46dd5" OR file_hash="ecb618a5e722fa360ece37191589305858a0e176321c933981f2884dcb0405" OR file_hash="1599fe6cc77764c17802cdfe1ca77f091bb3ec2a49f6cab1c80ee667ea7c752b" OR file_hash="b8567ce4d0595e6466414999798bcb1dfe01cc5ca1dd058bfc55f92033f0f3d8" OR file_hash="b252a8d2ec5c7080286fe3f0ad193062f506b5c34c4c797f97717e396c0a22d5" OR file_hash="9c14ffd79f863fec0a6c0ed37ea82a944db09afda53b8ac2aef1d49f74f4f" OR file_hash="5ed6b7b450ead2d0e69faa3069d1e0bd3a6852909092235f75087da0ca05462f" OR file_hash="a890c88b6c64371242b4047830b9189b4546536c6b11576d0738f0ba1840aded" OR file_hash="0c41358adeea24d80b35bac4b4f60d93711e32e287343cb604e1fa79b5e5e465")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Vietnam Targeted Campaign (2021-02-24)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Qatar Targeted Campaign (2021-05-28)', 'Qatar-targeted IoCs (domains, IPs). Full list at https://github.com/AmnestyTech/investigations/tree/master/2021-05-28_qatar (id: amnesty-inv-2021-05-28-qatar)', 'live', 'scheduled', '(((destination_domain="youl.tube" OR dest_ip="youl.tube" OR message=*youl.tube*) OR (destination_domain="twittre.co" OR dest_ip="twittre.co" OR message=*twittre.co*) OR (destination_domain="twit-er.app" OR dest_ip="twit-er.app" OR message=*twit-er.app*)) OR data_type=*network_socket* AND (dest_ip="138.197.103.227" OR dest_ip="128.199.212.166" OR dest_ip="161.35.100.139")) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Qatar Targeted Campaign (2021-05-28)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - NSO Pegasus Infrastructure (2021-07-18)', 'NSO Pegasus infrastructure IoCs (domains, emails, processes, files). Full list at https://github.com/AmnestyTech/investigations/tree/master/2021-07-18_nso (id: amnesty-inv-2021-07-18-nso)', 'live', 'scheduled', '(((destination_domain="123tramites.com" OR dest_ip="123tramites.com" OR message=*123tramites.com*) OR (destination_domain="14-tracking.com" OR dest_ip="14-tracking.com" OR message=*14-tracking.com*) OR (destination_domain="1minto-start.com" OR dest_ip="1minto-start.com" OR message=*1minto-start.com*) OR (destination_domain="24-7clinic.com" OR dest_ip="24-7clinic.com" OR message=*24-7clinic.com*) OR (destination_domain="301-redirecting.com" OR dest_ip="301-redirecting.com" OR message=*301-redirecting.com*) OR (destination_domain="365redirect.co" OR dest_ip="365redirect.co" OR message=*365redirect.co*) OR (destination_domain="accountnotify.com" OR dest_ip="accountnotify.com" OR message=*accountnotify.com*) OR (destination_domain="egov-sergek.info" OR dest_ip="egov-sergek.info" OR message=*egov-sergek.info*) OR (destination_domain="ehistorybooks.com" OR dest_ip="ehistorybooks.com" OR message=*ehistorybooks.com*) OR (destination_domain="findmyass.org" OR dest_ip="findmyass.org" OR message=*findmyass.org*) OR (destination_domain="legyelvodas.com" OR dest_ip="legyelvodas.com" OR message=*legyelvodas.com*) OR (destination_domain="pastesbin.com" OR dest_ip="pastesbin.com" OR message=*pastesbin.com*) OR (destination_domain="shia-voice.com" OR dest_ip="shia-voice.com" OR message=*shia-voice.com*) OR (destination_domain="so-this-is.com" OR dest_ip="so-this-is.com" OR message=*so-this-is.com*) OR (destination_domain="stopmysms.com" OR dest_ip="stopmysms.com" OR message=*stopmysms.com*) OR (destination_domain="videosdownload.co" OR dest_ip="videosdownload.co" OR message=*videosdownload.co*) OR (destination_domain="hmizat.co" OR dest_ip="hmizat.co" OR message=*hmizat.co*) OR (destination_domain="free247downloads.com" OR dest_ip="free247downloads.com" OR message=*free247downloads.com*) OR (destination_domain="revolution-news.co" OR dest_ip="revolution-news.co" OR message=*revolution-news.co*) OR (destination_domain="business-today.info" OR dest_ip="business-today.info" OR message=*business-today.info*)) OR (email="ameliehaggart@gmail.com" OR email="arvidamelia1@gmail.com" OR email="bekkerfredi@gmail.com" OR email="benjiburns8@gmail.com" OR email="emmadavies8266@gmail.com" OR email="filip.bl82@gmail.com" OR email="jessicadavies1345@outlook.com" OR email="kleinleon1987@gmail.com" OR email="krystynajasinska86@gmail.com" OR email="mitchkremer14@outlook.com" OR email="natalymarinova@proton.me") OR (process_name="com.apple.Mappit.SnapshotService" OR process_name="com.apple.rapports.events" OR process_name="CommsCenterRootHelper" OR process_name="GoldenGate" OR process_name="JarvisPluginMgr" OR process_name="MobileSMSd" OR process_name="PDPDialogs" OR process_name="ReminderIntentsUIExtension" OR process_name="launchafd" OR process_name="gatekeeperd") OR ((file_path=*roleaccountd.plist* OR message=*roleaccountd.plist* OR action=*roleaccountd.plist*))) | head 500', '0 */12 * * *', 'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - NSO Pegasus Infrastructure (2021-07-18)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - DoNot Team APT (2021-10-07)', 'DoNot (Donot) Team APT IoCs – domains and SHA256 hashes. Full list at https://github.com/AmnestyTech/investigations/tree/master/2021-10-07_donot (id: amnesty-inv-2021-10-07-donot)', 'live', 'scheduled', '(((destination_domain="bulk.fun" OR dest_ip="bulk.fun" OR message=*bulk.fun*) OR (destination_domain="apkv5.ppadaolnwod.xyz" OR dest_ip="apkv5.ppadaolnwod.xyz" OR message=*apkv5.ppadaolnwod.xyz*) OR (destination_domain="apkv6.endurecif.top" OR dest_ip="apkv6.endurecif.top" OR message=*apkv6.endurecif.top*) OR (destination_domain="getelements.xyz" OR dest_ip="getelements.xyz" OR message=*getelements.xyz*) OR (destination_domain="fiddaz.club" OR dest_ip="fiddaz.club" OR message=*fiddaz.club*) OR (destination_domain="lif0.top" OR dest_ip="lif0.top" OR message=*lif0.top*) OR (destination_domain="fif0.top" OR dest_ip="fif0.top" OR message=*fif0.top*) OR (destination_domain="chipp.pw" OR dest_ip="chipp.pw" OR message=*chipp.pw*) OR (destination_domain="mimestyle.xyz" OR dest_ip="mimestyle.xyz" OR message=*mimestyle.xyz*) OR (destination_domain="mangasiso.top" OR dest_ip="mangasiso.top" OR message=*mangasiso.top*) OR (destination_domain="and.retardrattle.website" OR dest_ip="and.retardrattle.website" OR message=*and.retardrattle.website*) OR (destination_domain="help.domainoutlet.site" OR dest_ip="help.domainoutlet.site" OR message=*help.domainoutlet.site*) OR (destination_domain="whynotworkonit.top" OR dest_ip="whynotworkonit.top" OR message=*whynotworkonit.top*) OR (destination_domain="spectronet.pw" OR dest_ip="spectronet.pw" OR message=*spectronet.pw*) OR (destination_domain="full.naturalpercent.life" OR dest_ip="full.naturalpercent.life" OR message=*full.naturalpercent.life*) OR (destination_domain="mimeversion.top" OR dest_ip="mimeversion.top" OR message=*mimeversion.top*) OR (destination_domain="rythemsjoy.club" OR dest_ip="rythemsjoy.club" OR message=*rythemsjoy.club*) OR (destination_domain="lowlight.xyz" OR dest_ip="lowlight.xyz" OR message=*lowlight.xyz*) OR (destination_domain="inapturst.top" OR dest_ip="inapturst.top" OR message=*inapturst.top*) OR (destination_domain="auth.forwardtoken.website" OR dest_ip="auth.forwardtoken.website" OR message=*auth.forwardtoken.website*) OR (destination_domain="accounts.loginshare.info" OR dest_ip="accounts.loginshare.info" OR message=*accounts.loginshare.info*) OR (destination_domain="seahome.top" OR dest_ip="seahome.top" OR message=*seahome.top*) OR (destination_domain="imageview.xyz" OR dest_ip="imageview.xyz" OR message=*imageview.xyz*) OR (destination_domain="flickry.xyz" OR dest_ip="flickry.xyz" OR message=*flickry.xyz*) OR (destination_domain="userauthen.pw" OR dest_ip="userauthen.pw" OR message=*userauthen.pw*) OR (destination_domain="join.officeframe.work" OR dest_ip="join.officeframe.work" OR message=*join.officeframe.work*) OR (destination_domain="zumba.tampotrust.agency" OR dest_ip="zumba.tampotrust.agency" OR message=*zumba.tampotrust.agency*) OR (destination_domain="image.loadingmessage.info" OR dest_ip="image.loadingmessage.info" OR message=*image.loadingmessage.info*)) OR (file_hash="000ddbb75d10a939b54a7ceea5f12563b855daec971a9da0f2b4d5f935e195a3" OR file_hash="03d10d2682093fa126f0eaa5cbfd64eabbb06e151238bba1a7e261468ec4198e" OR file_hash="066ae38cc8514c07360049099bf954e3e2470b18b19ff9fc13681b1c2e3089d5" OR file_hash="0848541d0eda16a5c16c920916092fb0e6f1555a9b12df9f8400f70d1b4d387d" OR file_hash="0c2494c03f07f891c67bb31390c12c84b0bb5eea132821c0873db7a87f27ccef" OR file_hash="0efdd55f9341dcf358872cdb42c943f2457f800886f5cfeb74fa07c0f5c750e9" OR file_hash="10143c8b913b5714688b5d439d11e3918cc45639c7725c1fc8e240e37091c354" OR file_hash="106645830653a937cf133baefbe02ccdf8a0b55b743473b720d9129a4360bdc1" OR file_hash="10a2d4fc913fa0931cf93c8725c1c9af20f22a4a35e619b1af17b84da326ea3f" OR file_hash="11764af75f241ccf8642558014ba29729585850a1efac86a5a8d4c7032c9bb40" OR file_hash="14fb7d317fff4fa2f02e106281dafa951c635adb3151343619440964370090f1" OR file_hash="16ab497d5b3af927264ca4ef36f605a3d0374a49c355d1a73b5a1a52a1d6c039" OR file_hash="175c0d04e9419432d0adffece655a338f71714d2b5cdc2639d1a5c5462b4e7ac" OR file_hash="19a2aeb938785c98e2692dc055ac6e2844cf0e70ba80b9bc6f192ab362b8a635" OR file_hash="2068cd66658eac0ac50202a9ae249e45abb4ee3c4f03f8cf8dd6998acbd75261" OR file_hash="236e0cd0914f1851072f54f4284d5af21842e47302b391e4780a14e84abb4269" OR file_hash="2606b863b512957a4af47a4ad6a319fa8e1e4349de691f30b89f1fb9acc71bb5" OR file_hash="2943fc4eec81e2da6c195b6e6a4e3c9b847f0da8079044c29b21d6fb06c84f0c" OR file_hash="2fb28fe0190041c47157df760dcb4f8865f2b450219016c95893d22d4eda22f0" OR file_hash="3587b0f5d18863992dcd124b103c50ecd32a2393c2cd1c0346c3a3cf8985e107" OR file_hash="42a116b3db5b1142f2812b1e73cd386c4381500fb95932f36aeb752179e25ef7" OR file_hash="4789b7c5940f6482cbb1c296b58e725f7ade070d2d8181627d90db86ff75ac7a" OR file_hash="4ed8ee387750da187bf327568d975d6e568ec6bfb92a0923e3a3cc04c6597514" OR file_hash="555578d8d5f116c55bfe8e8ac4794ecf67193668b52222e7a8d9fa919ee6eeac" OR file_hash="63efcbb541cd17a9b940e125a52245f50f06d5033b64ad7111be8d82202e3c37")) | head 500', '0 */12 * * *', 'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - DoNot Team APT (2021-10-07)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Cytrox Predator (2021-12-16)', 'Cytrox Predator IoCs – domains, file paths, config profiles. Full list at https://github.com/AmnestyTech/investigations/tree/master/2021-12-16_cytrox (id: amnesty-inv-2021-12-16-cytrox)', 'live', 'scheduled', '(((destination_domain="2y4nothing.xyz" OR dest_ip="2y4nothing.xyz" OR message=*2y4nothing.xyz*) OR (destination_domain="5m5.io" OR dest_ip="5m5.io" OR message=*5m5.io*) OR (destination_domain="bit-ly.link" OR dest_ip="bit-ly.link" OR message=*bit-ly.link*) OR (destination_domain="bit-ly.org" OR dest_ip="bit-ly.org" OR message=*bit-ly.org*) OR (destination_domain="connectivitycheck.live" OR dest_ip="connectivitycheck.live" OR message=*connectivitycheck.live*) OR (destination_domain="connectivitycheck.online" OR dest_ip="connectivitycheck.online" OR message=*connectivitycheck.online*) OR (destination_domain="youtube.gr.live" OR dest_ip="youtube.gr.live" OR message=*youtube.gr.live*) OR (destination_domain="youtube.voto" OR dest_ip="youtube.voto" OR message=*youtube.voto*) OR (destination_domain="yallakora-egy.com" OR dest_ip="yallakora-egy.com" OR message=*yallakora-egy.com*) OR (destination_domain="instagam.photos" OR dest_ip="instagam.photos" OR message=*instagam.photos*) OR (destination_domain="shorten.fi" OR dest_ip="shorten.fi" OR message=*shorten.fi*) OR (destination_domain="shortenurls.me" OR dest_ip="shortenurls.me" OR message=*shortenurls.me*) OR (destination_domain="browsercheck.services" OR dest_ip="browsercheck.services" OR message=*browsercheck.services*) OR (destination_domain="link-protection.com" OR dest_ip="link-protection.com" OR message=*link-protection.com*) OR (destination_domain="ebill.cosmote.center" OR dest_ip="ebill.cosmote.center" OR message=*ebill.cosmote.center*) OR (destination_domain="pdfviewer.app" OR dest_ip="pdfviewer.app" OR message=*pdfviewer.app*)) OR ((file_path=*/private/var/tmp/UserEventAgent* OR message=*/private/var/tmp/UserEventAgent* OR action=*/private/var/tmp/UserEventAgent*) OR (file_path=*/private/var/tmp/com.apple.WebKit.Networking* OR message=*/private/var/tmp/com.apple.WebKit.Networking* OR action=*/private/var/tmp/com.apple.WebKit.Networking*) OR (file_path=*/private/var/tmp/hooker* OR message=*/private/var/tmp/hooker* OR action=*/private/var/tmp/hooker*) OR (file_path=*/private/var/tmp/takePhoto* OR message=*/private/var/tmp/takePhoto* OR action=*/private/var/tmp/takePhoto*) OR (file_path=*/data/local/tmp/wd/fs.db* OR message=*/data/local/tmp/wd/fs.db* OR action=*/data/local/tmp/wd/fs.db*) OR (file_path=*/data/local/tmp/wd/* OR message=*/data/local/tmp/wd/* OR action=*/data/local/tmp/wd/*))) | head 500', '0 */12 * * *', 'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Cytrox Predator (2021-12-16)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Android Malware Campaign (2023-03-29)', 'Android malware campaign IoCs (domains, file paths, android_properties). Full list at https://github.com/AmnestyTech/investigations/tree/master/2023-03-29_android_campaign (id: amnesty-inv-2023-03-29-android-campaign)', 'live', 'scheduled', '(((destination_domain="ablazenutrient.net" OR dest_ip="ablazenutrient.net" OR message=*ablazenutrient.net*) OR (destination_domain="abreastelongated.com" OR dest_ip="abreastelongated.com" OR message=*abreastelongated.com*) OR (destination_domain="abroadwizard.net" OR dest_ip="abroadwizard.net" OR message=*abroadwizard.net*) OR (destination_domain="absintheskewer.net" OR dest_ip="absintheskewer.net" OR message=*absintheskewer.net*) OR (destination_domain="absolutecool.net" OR dest_ip="absolutecool.net" OR message=*absolutecool.net*) OR (destination_domain="abstainoxymoron.net" OR dest_ip="abstainoxymoron.net" OR message=*abstainoxymoron.net*) OR (destination_domain="acceptway.com" OR dest_ip="acceptway.com" OR message=*acceptway.com*) OR (destination_domain="acetonenemesis.net" OR dest_ip="acetonenemesis.net" OR message=*acetonenemesis.net*) OR (destination_domain="achinessfiddle.net" OR dest_ip="achinessfiddle.net" OR message=*achinessfiddle.net*) OR (destination_domain="acidconfront.link" OR dest_ip="acidconfront.link" OR message=*acidconfront.link*) OR (destination_domain="classicnames.eu" OR dest_ip="classicnames.eu" OR message=*classicnames.eu*) OR (destination_domain="classicwallets.eu" OR dest_ip="classicwallets.eu" OR message=*classicwallets.eu*) OR (destination_domain="click-grid.com" OR dest_ip="click-grid.com" OR message=*click-grid.com*) OR (destination_domain="click-grid.net" OR dest_ip="click-grid.net" OR message=*click-grid.net*) OR (destination_domain="click-grid.org" OR dest_ip="click-grid.org" OR message=*click-grid.org*) OR (destination_domain="climateyo-yo.net" OR dest_ip="climateyo-yo.net" OR message=*climateyo-yo.net*) OR (destination_domain="ddetik.net" OR dest_ip="ddetik.net" OR message=*ddetik.net*) OR (destination_domain="ddetik.org" OR dest_ip="ddetik.org" OR message=*ddetik.org*) OR (destination_domain="e-albania-services.com" OR dest_ip="e-albania-services.com" OR message=*e-albania-services.com*) OR (destination_domain="firsttask.nl" OR dest_ip="firsttask.nl" OR message=*firsttask.nl*)) OR ((file_path=*/data/local/tmp/dropbox* OR message=*/data/local/tmp/dropbox* OR action=*/data/local/tmp/dropbox*)) OR ((process_name=*sys.brand.note* OR bundle_id=*sys.brand.note*) OR (process_name=*sys.brand.notes* OR bundle_id=*sys.brand.notes*) OR (process_name=*sys.brand.doc* OR bundle_id=*sys.brand.doc*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Android Malware Campaign (2023-03-29)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Wintego Helios (2024-05-02)', 'Wintego Helios spyware IoCs (domains). Full list at https://github.com/AmnestyTech/investigations/tree/master/2024-05-02_wintego_helios (id: amnesty-inv-2024-05-02-wintego-helios)', 'live', 'scheduled', '(((destination_domain="africatech.eu" OR dest_ip="africatech.eu" OR message=*africatech.eu*) OR (destination_domain="alertanalysis.org" OR dest_ip="alertanalysis.org" OR message=*alertanalysis.org*) OR (destination_domain="androidcheckupdate.com" OR dest_ip="androidcheckupdate.com" OR message=*androidcheckupdate.com*) OR (destination_domain="galaxy-update-check.com" OR dest_ip="galaxy-update-check.com" OR message=*galaxy-update-check.com*) OR (destination_domain="galaxyupdate.network" OR dest_ip="galaxyupdate.network" OR message=*galaxyupdate.network*) OR (destination_domain="galaxyupdatecheck.com" OR dest_ip="galaxyupdatecheck.com" OR message=*galaxyupdatecheck.com*) OR (destination_domain="senego.fr" OR dest_ip="senego.fr" OR message=*senego.fr*) OR (destination_domain="senego.info" OR dest_ip="senego.info" OR message=*senego.info*) OR (destination_domain="seneweb.eu" OR dest_ip="seneweb.eu" OR message=*seneweb.eu*) OR (destination_domain="seneweb.news" OR dest_ip="seneweb.news" OR message=*seneweb.news*) OR (destination_domain="serverdetails.click" OR dest_ip="serverdetails.click" OR message=*serverdetails.click*) OR (destination_domain="techarmys.com" OR dest_ip="techarmys.com" OR message=*techarmys.com*) OR (destination_domain="techarmys.net" OR dest_ip="techarmys.net" OR message=*techarmys.net*) OR (destination_domain="tiktok.do" OR dest_ip="tiktok.do" OR message=*tiktok.do*) OR (destination_domain="tribunnews.org" OR dest_ip="tribunnews.org" OR message=*tribunnews.org*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Wintego Helios (2024-05-02)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'AmnestyTech Investigations - Serbia NoviSpy (2024-12-16)', 'Serbia NoviSpy IoCs (domains, SHA256, package names, package cert hashes). Full list at https://github.com/AmnestyTech/investigations/tree/master/2024-12-16_serbia_novispy (id: amnesty-inv-2024-12-16-serbia-novispy)', 'live', 'scheduled', '(data_type=*network_socket* AND (dest_ip="195.178.51.251" OR dest_ip="79.101.110.108" OR dest_ip="188.93.127.34" OR dest_ip="178.220.122.57" OR dest_ip="94.140.125.174" OR dest_ip="185.86.148.174" OR dest_ip="176.223.111.131") OR (file_hash="54ee2c4f3e2396b6f92def135d68abd35d63ca7f9c304633a36f705ba4728cb7" OR file_hash="d55e492d5fce87898e065572a5553d1ac1389cd12bf3d28cabc1218cb29780af" OR file_hash="99673ce7f10e938ed73ed4a99930fbd6499983caa7a2c1b9e3f0e0bb0a5df602" OR file_hash="087fc1217c897033425fe7f1f12b913cd48918c875e99c25bdb9e1ffcf80f57e") OR ((process_name=*com.serv.services* OR bundle_id=*com.serv.services*) OR (process_name=*com.accessibilityservice* OR bundle_id=*com.accessibilityservice*) OR (process_name=*com.li.activity* OR bundle_id=*com.li.activity*) OR (process_name=*com.gu.activity* OR bundle_id=*com.gu.activity*))) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'AmnestyTech Investigations - Serbia NoviSpy (2024-12-16)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'CVE 2025-21055', 'Detects CVE 2025-21055 exploitation from Android Tombstone (id: cve-2025-21055)', 'live', 'scheduled', '(data_type=*tombstone_backtrace* AND (function=*QuramDngOpcodeScalePerColumn::processArea*)) | head 500', '0 */12 * * *', 'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-21055');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'CVE 2025-27363 FreeType tombstone backtrace',
    'CVE-2025-27363: tombstone backtrace in libfreetype/libft2 (variable-font GX_VAR phantom-point OOB). Actively exploited; CISA KEV May 2025.',
    'live',
    'scheduled',
    'platform="android" data_type=*tombstone_backtrace* (library=*freetype* OR library=*libft2* OR message=*libft2* OR message=*freetype*) | head 500',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-27363 FreeType tombstone backtrace');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'CVE 2025-27363 load_truetype_glyph frame',
    'CVE-2025-27363: tombstone frame in load_truetype_glyph / ttgload.c (num_subglyphs 0xFFFD signed-short truncation).',
    'live',
    'scheduled',
    'platform="android" data_type=*tombstone_backtrace* (function=*load_truetype_glyph* OR function=*ttgload* OR message=*load_truetype_glyph* OR message=*ttgload*) | head 500',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-27363 load_truetype_glyph frame');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'CVE 2025-27363 BIGPRETZEL forensic artifact',
    'BIGPRETZEL log marker on CVE-2025-27363 spyware-compromised devices (post-exploitation).',
    'live',
    'scheduled',
    'platform="android" message=*BIGPRETZEL* | head 100',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-27363 BIGPRETZEL forensic artifact');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'CVE 2025-27363 EOL Android exposure',
    'Android 10–12 bugreport header — EOL before May 2025 FreeType fix (exposure context).',
    'live',
    'scheduled',
    'platform="android" parser="Header" (message=*:10/* OR message=*:11/* OR message=*:12/* OR message=*"Android SDK version=10"* OR message=*"Android SDK version=11"* OR message=*"Android SDK version=12"*) | head 50',
    '0 */24 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-27363 EOL Android exposure');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'CVE 2025-27363 messaging app FreeType crash',
    'CVE-2025-27363: FreeType tombstone in messaging/PDF-preview app (WhatsApp zero-click PDF font path).',
    'live',
    'scheduled',
    'platform="android" data_type=*tombstone_backtrace* (process_name=*whatsapp* OR process_name=*messaging* OR bundle_id=*whatsapp* OR bundle_id=*com.whatsapp*) (library=*freetype* OR library=*libft2* OR message=*freetype* OR message=*libft2*) | head 200',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'CVE 2025-27363 messaging app FreeType crash');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword iOS network IoCs',
    'Delivery, watering-hole, and exfiltration domains/IPs for DarkSword (UNC6748, PARS Defense, UNC6353, GHOSTKNIFE C2). Ref: Google GTIG Mar 2026.',
    'live',
    'scheduled',
    'platform="ios" (((destination_domain="snapshare.chat" OR dest_ip="snapshare.chat" OR message=*snapshare.chat*) OR (destination_domain="sahibndn.io" OR dest_ip="sahibndn.io" OR message=*sahibndn.io*) OR (destination_domain="e5.malaymoil.com" OR dest_ip="e5.malaymoil.com" OR message=*e5.malaymoil.com*) OR (destination_domain="static.cdncounter.net" OR dest_ip="static.cdncounter.net" OR message=*static.cdncounter.net*) OR (destination_domain="sqwas.shapelie.com" OR dest_ip="sqwas.shapelie.com" OR message=*sqwas.shapelie.com*) OR (destination_domain="novosti.dn.ua" OR dest_ip="novosti.dn.ua" OR message=*novosti.dn.ua*) OR (destination_domain="7aac.gov.ua" OR dest_ip="7aac.gov.ua" OR message=*7aac.gov.ua*)) OR (dest_ip="62.72.21.10" OR message=*62.72.21.10*) OR (dest_ip="72.60.98.48" OR message=*72.60.98.48*)) | head 500',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword iOS network IoCs');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword GHOSTBLADE filesystem artifacts',
    'Post-exploitation GHOSTBLADE file artifacts (WiFi dumps, keychain copies, iCloud staging). Ref: GTIG YARA, iVerify, AntonioCiolino/DarkSword-Analysis §7.',
    'live',
    'scheduled',
    'platform="ios" ((file_path=*wifi_passwords* OR message=*wifi_passwords* OR action=*wifi_passwords*) OR (file_path=*wifi_passwords_securityd.txt* OR message=*wifi_passwords_securityd.txt*) OR (file_path=*icloud_dump* OR message=*icloud_dump*) OR (file_path=*keychain_dump.txt* OR message=*keychain_dump.txt*) OR (file_path=*/private/var/tmp/keychain-2.db* OR message=*/private/var/tmp/keychain-2.db*) OR (file_path=*keychain_copy* OR message=*keychain_copy*) OR (file_path=*keybag_copy* OR message=*keybag_copy*) OR (file_path=*PostLogs.txt* OR message=*PostLogs.txt*) OR (file_path=*persona_keychains.kb* OR message=*persona_keychains.kb*) OR (file_path=*usersession_keychains.kb* OR message=*usersession_keychains.kb*) OR (file_path=*installed_apps.txt* OR message=*installed_apps.txt*)) | head 200',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword GHOSTBLADE filesystem artifacts');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword unified log exploit tags',
    'Unified-log markers from DarkSword chain (DarkSword-WIFI-DUMP, MIG_FILTER_BYPASS, TASKROP). Requires logarchive decode at ingest.',
    'live',
    'scheduled',
    'platform="ios" parser="logarchive" action="logarchive_event" (message=*DarkSword-WIFI-DUMP* OR message=*MIG_FILTER_BYPASS* OR message=*DRIVER-NEWTHREAD* OR message=*TASKROP* OR message=*Hello from* OR message=*target corrupted* OR message=*Running on non-A18*) | head 100',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword unified log exploit tags');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword exploit crash cluster',
    'Crash reports consistent with DarkSword chain stages — not isolated process names. High confidence: EXC_ARM_DA_ALIGN at PC 0x0000000000000201 in injection targets (configd, UserEventAgent, wifid, securityd). Also mediaplaybackd EXC_ARM_DA_ALIGN and EXC_GUARD in injection targets or WebKit sandbox-escape processes. Ref iVerify, GTIG, AntonioCiolino/DarkSword-Analysis §5.4.',
    'live',
    'scheduled',
    'platform="ios" parser="crashlogs" ((message=*EXC_ARM_DA_ALIGN* AND message=*0x0000000000000201* AND (message=*configd* OR message=*UserEventAgent* OR message=*wifid* OR message=*securityd*)) OR (message=*mediaplaybackd* AND message=*EXC_ARM_DA_ALIGN*) OR (message=*EXC_GUARD* AND (message=*configd* OR message=*UserEventAgent* OR message=*wifid* OR message=*securityd*)) OR (message=*EXC_GUARD* AND (message=*WebKit.WebContent* OR message=*WebKit.GPU*))) | head 200',
    '0 */12 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword exploit crash cluster');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword implant JavaScript strings',
    'GHOSTKNIFE/GHOSTSABER/GHOSTBLADE implant strings (GTIG YARA). Ref: Google GTIG Mar 2026.',
    'live',
    'scheduled',
    'platform="ios" (message=*sendDeviceInfoJson* OR message=*getfilebyExtention* OR message=*send_command_to_upper_process* OR message=*ChangeStatusCheckSleepInterval* OR message=*device_info_all* OR message=*server_pub_ex* OR message=*client_pri_ds* OR message=*X-Device-UUID* OR message=*icloud_dump_*) | head 200',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword implant JavaScript strings');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword exploit stage filenames',
    'Safari delivery, exploit-chain and payload JS filenames (rce_worker.js, file_downloader.js, etc.). Ref: GTIG, iVerify, AntonioCiolino/DarkSword-Analysis §3–§5.',
    'live',
    'scheduled',
    'platform="ios" (message=*rce_loader.js* OR message=*rce_worker.js* OR message=*rce_worker_18.4.js* OR message=*rce_worker_18.6.js* OR message=*rce_worker_18.7.js* OR message=*rce_module.js* OR message=*sbx0_main* OR message=*sbx1_main* OR message=*pe_main.js* OR message=*frame.html* OR message=*file_downloader.js* OR message=*keychain_copier.js* OR message=*wifi_password_dump.js* OR message=*icloud_dumper.js* OR url=*rce_loader.js*) | head 100',
    '0 */12 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword exploit stage filenames');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword GHOSTBLADE sample SHA256',
    'SHA256 of extracted GHOSTBLADE sample (UNC6353). Ref: Google GTIG IOC table Mar 2026.',
    'live',
    'scheduled',
    'platform="ios" file_hash="2e5a56beb63f21d9347310412ae6efb29fd3db2d3a3fc0798865a29a3c578d35" | head 50',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword GHOSTBLADE sample SHA256');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword Ciolino exploit webpack modules',
    'Webpack module filenames from reconstructed DarkSword chain (DriverNewThread.js, RemoteCall.js, InjectJS.js). Ref: AntonioCiolino/DarkSword-Analysis §3–§5.',
    'live',
    'scheduled',
    'platform="ios" (message=*DriverNewThread.js* OR message=*MigFilterBypassThread.js* OR message=*RemoteCall.js* OR message=*InjectJS.js* OR message=*PortRightInserter.js* OR message=*OffsetsTable.js* OR message=*mach_make_memory_entry_64* OR message=*mach_vm_map*) | head 100',
    '0 */12 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword Ciolino exploit webpack modules');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword Ciolino C2 exfil ports',
    'DarkSword exfiltration ports 8882/8881 to sqwas.shapelie.com / static.cdncounter.net. Ref: AntonioCiolino/DarkSword-Analysis §7.',
    'live',
    'scheduled',
    'platform="ios" ((remote_port=8882 OR remote_port=8881 OR local_port=8882 OR local_port=8881 OR message=*:8882* OR message=*:8881*) AND (destination_domain=*shapelie.com* OR message=*sqwas.shapelie.com* OR message=*static.cdncounter.net*)) | head 100',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword Ciolino C2 exfil ports');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'DarkSword Ciolino behavioral indicators',
    'Post-exploitation behaviors from reconstructed DarkSword chain — correlated indicators only (WebContent framework load abuse, ICMPv6 kernel R/W in mediaplaybackd, cross-process JS injection, JSC in system daemons, AirPort keychain queries). Ref AntonioCiolino/DarkSword-Analysis §3–§7.',
    'live',
    'scheduled',
    'platform="ios" ((message=*TextToSpeech.framework* AND message=*WebKit.WebContent*) OR (message=*PerfPowerServicesReader* AND message=*WebKit.WebContent*) OR (message=*ICMP6_FILTER* AND message=*IPPROTO_ICMPV6* AND message=*mediaplaybackd*) OR (message=*JSObjectMakeArrayBufferWithBytesNoCopy* AND message=*thread_set_exception_ports* AND message=*pthread_create_suspended_np*) OR (message=*SecItemCopyMatching* AND message=*AirPort* AND (message=*wifid* OR message=*securityd*)) OR (message=*JavaScriptCore* AND (message=*configd* OR message=*wifid* OR message=*securityd* OR message=*UserEventAgent* OR message=*SpringBoard*))) | head 100',
    '0 */12 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'DarkSword Ciolino behavioral indicators');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'Cellebrite on Android', 'Detects Cellebrite Used Against Jordanian Civil Society => (https://citizenlab.ca/research/from-protest-to-peril-cellebrite-used-against-jordanian-civil-society/) (id: 426e58ac-4a36-4dcc-9d98-4f621b1a89d0)', 'live', 'scheduled', '((bundle_id="com.client.appA")) | head 500', '0 */12 * * *', 'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'Cellebrite on Android');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT 'NoviSpy Android spyware', 'Detects NoviSpy Android spyware => https://github.com/AmnestyTech/investigations/tree/master/2024-12-16_serbia_novispy (id: 5b3d6582-6c45-463a-92f6-8657dc199a0c)', 'live', 'scheduled', '((bundle_id="com.serv.services" OR bundle_id="com.accesibilityservice" OR bundle_id="com.li.activity" OR bundle_id="com.gu.activity")) | head 500', '0 */12 * * *', 'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'NoviSpy Android spyware');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'Spyrtacus Android spyware (packages)',
    'Detects Spyrtacus Android spyware package names (SIO / Osservatorio Nessuno). Packages: com.elysium.core, it.taog, org.util.carriersvc, sys.base.service. See examples/mobipwn-queries/rules/cve/android/spyrtacus.yaml and https://osservatorionessuno.org/blog/2026/04/italian-spyware-maker-sio-still-developing-and-distributing-spyrtacus/',
    'live',
    'scheduled',
    'platform="android" (bundle_id="com.elysium.core" OR bundle_id="it.taog" OR bundle_id="org.util.carriersvc" OR bundle_id="sys.base.service" OR process_name=*com.elysium.core* OR process_name=*it.taog* OR process_name=*org.util.carriersvc* OR process_name=*sys.base.service*) | head 500',
    '0 */12 * * *',
    'critical'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'Spyrtacus Android spyware (packages)');

INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT
    'MVT Indicators - Spyrtacus / SIO (2026-04-09)',
    'Spyrtacus Android spyware IoCs (packages, C2 domains/IPs, C2 favicon SHA256) from mvt-project/mvt-indicators 2026-04-09_sio_spyrtacus. See examples/mobipwn-queries/rules/mvt/2026_04_09_sio_spyrtacus.yaml.',
    'live',
    'scheduled',
    'platform="android" ((bundle_id="com.elysium.core" OR bundle_id="it.taog" OR bundle_id="org.util.carriersvc" OR bundle_id="sys.base.service" OR process_name=*com.elysium.core* OR process_name=*it.taog* OR process_name=*org.util.carriersvc* OR process_name=*sys.base.service*) OR (dest_ip="5.56.12.150" OR dest_ip="89.46.67.218" OR message=*5.56.12.150* OR message=*89.46.67.218*) OR (destination_domain="supporto-mobile.it" OR destination_domain="srv.servicemnt.com" OR message=*supporto-mobile.it* OR message=*srv.servicemnt.com*) OR (file_hash="ef2e1c47166fe0c5ab3bf5216baf6ad6b96f759e15ac218d1a1a3cdcc9e0994f" OR message=*ef2e1c47166fe0c5ab3bf5216baf6ad6b96f759e15ac218d1a1a3cdcc9e0994f*)) | head 500',
    '0 */12 * * *',
    'high'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = 'MVT Indicators - Spyrtacus / SIO (2026-04-09)');


-- Package install rule (bugreport package_metadata + installer field)
INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity, min_hits, max_alerts_per_run)
SELECT
    'Package installed outside default installer',
    'Android package metadata where a third-party package installed the app (excludes Play/system installers, OEM updaters, /system/ apps, and self-updates). See examples/mobipwn-queries/rules/mobile/sideload_package_install.yaml.',
    'live',
    'scheduled',
    'parser="Package" platform="android" data_type=*package_metadata* installer=* installer NOT IN ("com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller", "null", "com.facebook.system", "com.samsung.android.app.updatecenter", "com.sec.android.app.samsungapps", "com.android.managedprovisioning", "android") !file_path=*/system/* installer!=bundle_id | head 100',
    '0 */12 * * *',
    'high',
    1,
    50
WHERE NOT EXISTS (
    SELECT 1 FROM detection_rules WHERE name = 'Package installed outside default installer'
);

-- iOS sideload / persistence tools (TrollStore family)
INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity, min_hits, max_alerts_per_run)
SELECT
    'iOS sideload tools (TrollStore / AltStore / TrollDecrypt)',
    'Presence of TrollStore, TrollDecrypt, AltStore, or Sideloadly on iOS (unsigned install / persistence). See examples/mobipwn-queries/rules/ios/trollstore_sideload_tools.yaml.',
    'live',
    'scheduled',
    'platform="ios" (bundle_id="com.opa334.TrollStore" OR bundle_id="com.opa334.TrollStoreLite" OR bundle_id="com.fiore.trolldecrypt" OR bundle_id=*TrollStore* OR bundle_id=*trolldecrypt* OR bundle_id=*altstore* OR process_name=*TrollStore* OR process_name=*TrollDecrypt* OR process_name=*AltStore* OR message=*TrollStore* OR message=*TrollDecrypt* OR message=*com.opa334.TrollStore* OR message=*com.fiore.trolldecrypt* OR message=*AltStore* OR message=*Sideloadly*) | head 100',
    '0 */12 * * *',
    'high',
    1,
    50
WHERE NOT EXISTS (
    SELECT 1 FROM detection_rules WHERE name = 'iOS sideload tools (TrollStore / AltStore / TrollDecrypt)'
);

-- Assign seeded rules to repository folders
UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111202'::uuid,
    tags = ARRAY['amnesty', 'investigation']
WHERE repository_id IS NULL
  AND name LIKE 'AmnestyTech%';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111205'::uuid,
    tags = ARRAY['cve', 'android']
WHERE repository_id IS NULL
  AND (
    name LIKE 'CVE %'
    OR name IN ('Cellebrite on Android', 'NoviSpy Android spyware', 'Spyrtacus Android spyware (packages)')
  );

UPDATE detection_rules
SET tags = ARRAY['cve', 'android', 'cve.2025.27363', 'cisa.kev']
WHERE name LIKE 'CVE 2025-27363%';

UPDATE detection_rules
SET
    tags = ARRAY['spyware', 'android', 'spyrtacus', 'mvt']
WHERE name = 'Spyrtacus Android spyware (packages)';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111208'::uuid,
    tags = ARRAY['darksword', 'ios', 'spyware', 'threat-intel']
WHERE name LIKE 'DarkSword%'
  AND name NOT LIKE 'DarkSword Ciolino%';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111208'::uuid,
    tags = ARRAY['darksword', 'ios', 'spyware', 'threat-intel', 'ciolino']
WHERE name LIKE 'DarkSword Ciolino%';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111209'::uuid,
    tags = ARRAY['mvt', 'spyrtacus', 'android', 'spyware', 'threat-intel']
WHERE name = 'MVT Indicators - Spyrtacus / SIO (2026-04-09)';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111203'::uuid,
    tags = ARRAY['mobile', 'ios', 'sideload']
WHERE name = 'iOS sideload tools (TrollStore / AltStore / TrollDecrypt)';

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111203'::uuid,
    tags = ARRAY['mobile']
WHERE repository_id IS NULL
  AND (
    name = 'Package installed outside default installer'
    OR name ILIKE 'bugreport%'
    OR name ILIKE '%package%'
    OR name ILIKE '%mobile%'
  );

UPDATE detection_rules
SET
    repository_id = '11111111-1111-1111-1111-111111111101'::uuid,
    folder_id = '11111111-1111-1111-1111-111111111201'::uuid
WHERE repository_id IS NULL;
