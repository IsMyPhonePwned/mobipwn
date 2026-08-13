import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileJson,
  Filter,
  Radio,
  RefreshCw,
  ScrollText,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompactDataTable } from "@/components/ui/CompactDataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpsPanel } from "@/components/ui/OpsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import {
  fetchAlertToSiemConfig,
  fetchAlertToSiemLogs,
  formatRuleIdList,
  parseRuleIdList,
  saveAlertToSiemConfig,
  testAlertToSiemConnection,
  type AlertSiemForwardLog,
  type SplunkHecEndpoint,
  type SplunkHostMode,
} from "@/lib/alertSiem";
import { hasPermission } from "@/lib/permissions";

const SEVERITY_OPTIONS = ["", "info", "low", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = ["new", "triaged", "verified", "false_positive"] as const;
const HOST_MODES: SplunkHostMode[] = ["fixed", "device_id", "source", "platform"];
const HEC_ENDPOINTS: SplunkHecEndpoint[] = ["event", "raw"];
const MASKED = "********";

function SiemOptionToggle({
  checked,
  disabled,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`alert-to-siem-toggle${checked ? " alert-to-siem-toggle--on" : ""}${disabled ? " alert-to-siem-toggle--disabled" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="alert-to-siem-toggle__track" aria-hidden />
      <span className="alert-to-siem-toggle__content">
        <strong>{title}</strong>
        <span className="alert-to-siem-toggle__desc">{description}</span>
      </span>
    </label>
  );
}

function buildPayloadPreview(
  includeSample: boolean,
  useAlertTime: boolean,
  extraJson: string,
): { text: string; extraValid: boolean } {
  let extraValid = true;
  let extraLines: string[] = [];
  try {
    const parsed = JSON.parse(extraJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      extraLines = keys.map((k) => `  "${k}": …`);
    } else if (extraJson.trim() !== "{}") {
      extraValid = false;
    }
  } catch {
    extraValid = false;
  }

  const lines = [
    "{",
    '  "event_type": "mobipwn_alert",',
    '  "alert_id": "550e8400-…",',
    '  "rule_name": "Suspicious process",',
    '  "severity": "high",',
    '  "status": "new",',
    '  "context": { "platform": "android", … },',
  ];
  if (includeSample) {
    lines.push('  "sample_event": { "message": "…", … },');
  }
  if (extraLines.length > 0) {
    lines.push(...extraLines.map((l) => `${l},`));
  }
  lines.push(
    useAlertTime
      ? '  "last_seen": "2026-06-04T12:00:00Z"  ← Splunk time'
      : '  "last_seen": "2026-06-04T12:00:00Z"',
    "}",
  );
  return { text: lines.join("\n"), extraValid };
}

const SECTIONS = [
  { id: "alert-to-siem-connection", labelKey: "configTitle" as const, theme: "cyan" as const },
  { id: "alert-to-siem-forwarding", labelKey: "forwardingTitle" as const, theme: "orange" as const },
  { id: "alert-to-siem-payload", labelKey: "payloadTitle" as const, theme: "purple" as const },
  { id: "alert-to-siem-logs", labelKey: "logsTitle" as const, theme: "green" as const },
];

export default function AlertToSiemPage() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canWrite = hasPermission(user, "settings_write");

  const [forwardEnabled, setForwardEnabled] = useState(false);
  const [hecUrl, setHecUrl] = useState("");
  const [hecToken, setHecToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [index, setIndex] = useState("main");
  const [sourcetype, setSourcetype] = useState("mobipwn:alert");
  const [source, setSource] = useState("mobipwn");
  const [host, setHost] = useState("mobipwn");
  const [hostMode, setHostMode] = useState<SplunkHostMode>("fixed");
  const [channel, setChannel] = useState("");
  const [hecEndpoint, setHecEndpoint] = useState<SplunkHecEndpoint>("event");
  const [verifyTls, setVerifyTls] = useState(true);
  const [timeoutSecs, setTimeoutSecs] = useState(15);
  const [forwardOnUpdate, setForwardOnUpdate] = useState(false);
  const [forwardOnStatusChange, setForwardOnStatusChange] = useState(false);
  const [statusForwardStatuses, setStatusForwardStatuses] = useState<string[]>([]);
  const [forwardOnlyOpen, setForwardOnlyOpen] = useState(true);
  const [minSeverity, setMinSeverity] = useState("");
  const [includeSampleEvent, setIncludeSampleEvent] = useState(true);
  const [useAlertTimestamp, setUseAlertTimestamp] = useState(true);
  const [extraFieldsJson, setExtraFieldsJson] = useState("{}");
  const [ruleIdsInclude, setRuleIdsInclude] = useState("");
  const [ruleIdsExclude, setRuleIdsExclude] = useState("");

  const [logs, setLogs] = useState<AlertSiemForwardLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [testMsg, setTestMsg] = useState("");

  const loadConfig = useCallback(async () => {
    const cfg = await fetchAlertToSiemConfig();
    setForwardEnabled(cfg.forward_enabled);
    setHecUrl(cfg.splunk_hec_url);
    setTokenSet(cfg.splunk_token_set);
    setHecToken("");
    setIndex(cfg.splunk_index);
    setSourcetype(cfg.splunk_sourcetype);
    setSource(cfg.splunk_source);
    setHost(cfg.splunk_host);
    setHostMode(cfg.splunk_host_mode);
    setChannel(cfg.splunk_channel);
    setHecEndpoint(cfg.hec_endpoint);
    setVerifyTls(cfg.verify_tls);
    setTimeoutSecs(cfg.http_timeout_secs);
    setForwardOnUpdate(cfg.forward_on_update);
    setForwardOnStatusChange(cfg.forward_on_status_change);
    setStatusForwardStatuses(cfg.status_forward_statuses);
    setForwardOnlyOpen(cfg.forward_only_open_alerts);
    setMinSeverity(cfg.min_severity ?? "");
    setIncludeSampleEvent(cfg.include_sample_event);
    setUseAlertTimestamp(cfg.use_alert_timestamp);
    setExtraFieldsJson(JSON.stringify(cfg.extra_event_fields ?? {}, null, 2));
    setRuleIdsInclude(formatRuleIdList(cfg.rule_ids_include));
    setRuleIdsExclude(formatRuleIdList(cfg.rule_ids_exclude));
  }, []);

  const loadLogs = useCallback(async () => {
    const rows = await fetchAlertToSiemLogs(150);
    setLogs(rows);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      await Promise.all([loadConfig(), loadLogs()]);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [loadConfig, loadLogs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleStatusForward = (status: string) => {
    setStatusForwardStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };

  const buildPayload = () => {
    let extra: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(extraFieldsJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extra = parsed as Record<string, unknown>;
      } else {
        throw new Error(t("alertToSiem.extraFieldsInvalid"));
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error(t("alertToSiem.extraFieldsInvalid"));
    }

    return {
      forward_enabled: forwardEnabled,
      destination: "splunk_hec" as const,
      splunk_hec_url: hecUrl.trim(),
      splunk_token: hecToken.trim() || (tokenSet ? MASKED : ""),
      splunk_index: index.trim() || "main",
      splunk_sourcetype: sourcetype.trim() || "mobipwn:alert",
      splunk_source: source.trim() || "mobipwn",
      splunk_host: host.trim() || "mobipwn",
      splunk_host_mode: hostMode,
      splunk_channel: channel.trim(),
      hec_endpoint: hecEndpoint,
      verify_tls: verifyTls,
      http_timeout_secs: Math.min(120, Math.max(1, timeoutSecs || 15)),
      forward_on_update: forwardOnUpdate,
      forward_on_status_change: forwardOnStatusChange,
      status_forward_statuses: statusForwardStatuses,
      forward_only_open_alerts: forwardOnlyOpen,
      min_severity: minSeverity.trim() || null,
      include_sample_event: includeSampleEvent,
      use_alert_timestamp: useAlertTimestamp,
      extra_event_fields: extra,
      rule_ids_include: parseRuleIdList(ruleIdsInclude),
      rule_ids_exclude: parseRuleIdList(ruleIdsExclude),
    };
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    log("info", "Save AlertToSiem config");
    try {
      await saveAlertToSiemConfig(buildPayload());
      await loadConfig();
      setMsg(t("alertToSiem.saved"));
      log("info", "AlertToSiem config saved");
    } catch (e) {
      setMsg(String(e));
      log("error", "AlertToSiem save failed", String(e));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestMsg("");
    log("info", "Test AlertToSiem connection");
    try {
      if (canWrite) {
        await saveAlertToSiemConfig(buildPayload());
        await loadConfig();
      }
      const res = await testAlertToSiemConnection();
      setTestMsg(res.message);
      log("info", "AlertToSiem test OK", res.message);
      await loadLogs();
    } catch (e) {
      const err = String(e);
      setTestMsg(err);
      log("error", "AlertToSiem test failed", err);
      await loadLogs();
    } finally {
      setTesting(false);
    }
  };

  const connectionReady = Boolean(hecUrl.trim() && (tokenSet || hecToken.trim()));
  const recentSuccess = logs.find((r) => r.status === "success");
  const recentError = logs.find((r) => r.status === "error");

  const payloadPreview = useMemo(
    () => buildPayloadPreview(includeSampleEvent, useAlertTimestamp, extraFieldsJson),
    [includeSampleEvent, useAlertTimestamp, extraFieldsJson],
  );

  const resetExtraFields = () => setExtraFieldsJson("{}");

  return (
    <div className="alert-to-siem-page">
      <PageHeader
        title={t("alertToSiem.title")}
        description={t("alertToSiem.subtitle")}
        actions={
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden />
            {t("common.refresh")}
          </Button>
        }
      />

      <div className="alert-to-siem-page__intro">
        <p className="alert-to-siem-page__hint muted text-sm">
          {t("alertToSiem.pluginsHint")}{" "}
          <Link to="/settings?tab=plugins">{t("plugins.openSettings")}</Link>
        </p>

        {!loading && (
          <div className="alert-to-siem-status-strip" role="status" aria-live="polite">
            <span
              className={`alert-to-siem-pill${forwardEnabled ? " alert-to-siem-pill--on" : ""}`}
            >
              {forwardEnabled ? t("alertToSiem.statusForwardingOn") : t("alertToSiem.statusForwardingOff")}
            </span>
            <span
              className={`alert-to-siem-pill${connectionReady ? " alert-to-siem-pill--on" : " alert-to-siem-pill--warn"}`}
            >
              {connectionReady ? t("alertToSiem.statusConnectionOk") : t("alertToSiem.statusConnectionMissing")}
            </span>
            {recentSuccess && (
              <span className="alert-to-siem-pill alert-to-siem-pill--muted">
                {t("alertToSiem.statusLastOk", {
                  time: new Date(recentSuccess.created_at).toLocaleString(),
                })}
              </span>
            )}
            {recentError && !recentSuccess && (
              <span className="alert-to-siem-pill alert-to-siem-pill--warn">
                {t("alertToSiem.statusLastError")}
              </span>
            )}
          </div>
        )}
      </div>

      {!loading && (
        <nav className="alert-to-siem-section-nav" aria-label={t("alertToSiem.sectionNav")}>
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`alert-to-siem-section-nav__link alert-to-siem-section-nav__link--${section.theme}`}
            >
              {t(`alertToSiem.${section.labelKey}`)}
            </a>
          ))}
        </nav>
      )}

      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <div className="alert-to-siem-layout">
          <div className="alert-to-siem-config-stack">
            <OpsPanel
              id="alert-to-siem-connection"
              theme="cyan"
              icon={Radio}
              title={t("alertToSiem.configTitle")}
              hint={t("alertToSiem.configSubtitle")}
              className="alert-to-siem-panel"
            >
              <div className="alert-to-siem-master-toggle">
                <label className="alert-to-siem-master-toggle__label">
                  <input
                    type="checkbox"
                    checked={forwardEnabled}
                    disabled={!canWrite}
                    onChange={(e) => setForwardEnabled(e.target.checked)}
                  />
                  <span className="alert-to-siem-master-toggle__text">
                    <strong>{t("alertToSiem.forwardEnabled")}</strong>
                    <span className="muted text-sm">{t("alertToSiem.forwardEnabledHint")}</span>
                  </span>
                </label>
              </div>

              <div className="alert-to-siem-form-grid">
                <label className="alert-to-siem-field alert-to-siem-field--span2">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.hecUrl")}</span>
                  <input
                    type="url"
                    value={hecUrl}
                    disabled={!canWrite}
                    placeholder="https://splunk.example.com:8088"
                    onChange={(e) => setHecUrl(e.target.value)}
                  />
                  <span className="alert-to-siem-field__hint">{t("alertToSiem.hecUrlHint")}</span>
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.hecToken")}</span>
                  <input
                    type="password"
                    value={hecToken}
                    disabled={!canWrite}
                    placeholder={tokenSet ? MASKED : t("alertToSiem.hecTokenPlaceholder")}
                    onChange={(e) => setHecToken(e.target.value)}
                    autoComplete="off"
                  />
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.hecEndpoint")}</span>
                  <select
                    value={hecEndpoint}
                    disabled={!canWrite}
                    onChange={(e) => setHecEndpoint(e.target.value as SplunkHecEndpoint)}
                  >
                    {HEC_ENDPOINTS.map((ep) => (
                      <option key={ep} value={ep}>
                        {t(`alertToSiem.hecEndpoint_${ep}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.channel")}</span>
                  <input
                    value={channel}
                    disabled={!canWrite}
                    placeholder={t("alertToSiem.channelPlaceholder")}
                    onChange={(e) => setChannel(e.target.value)}
                  />
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.index")}</span>
                  <input value={index} disabled={!canWrite} onChange={(e) => setIndex(e.target.value)} />
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.sourcetype")}</span>
                  <input
                    value={sourcetype}
                    disabled={!canWrite}
                    onChange={(e) => setSourcetype(e.target.value)}
                  />
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.source")}</span>
                  <input value={source} disabled={!canWrite} onChange={(e) => setSource(e.target.value)} />
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.hostMode")}</span>
                  <select
                    value={hostMode}
                    disabled={!canWrite}
                    onChange={(e) => setHostMode(e.target.value as SplunkHostMode)}
                  >
                    {HOST_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`alertToSiem.hostMode_${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.host")}</span>
                  <input
                    value={host}
                    disabled={!canWrite || hostMode !== "fixed"}
                    onChange={(e) => setHost(e.target.value)}
                  />
                  <span className="alert-to-siem-field__hint">{t("alertToSiem.hostHint")}</span>
                </label>

                <label className="alert-to-siem-field">
                  <span className="alert-to-siem-field__label">{t("alertToSiem.timeout")}</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={timeoutSecs}
                    disabled={!canWrite}
                    onChange={(e) => setTimeoutSecs(Number(e.target.value))}
                  />
                </label>

                <label className="alert-to-siem-field alert-to-siem-field--check">
                  <input
                    type="checkbox"
                    checked={verifyTls}
                    disabled={!canWrite}
                    onChange={(e) => setVerifyTls(e.target.checked)}
                  />
                  <span>{t("alertToSiem.verifyTls")}</span>
                </label>
              </div>
            </OpsPanel>

            <OpsPanel
              id="alert-to-siem-forwarding"
              theme="orange"
              icon={Filter}
              title={t("alertToSiem.forwardingTitle")}
              hint={t("alertToSiem.forwardingSubtitle")}
              className="alert-to-siem-panel alert-to-siem-panel--forwarding"
            >
              <div className="alert-to-siem-forwarding-layout">
                <section className="alert-to-siem-forward-block">
                  <h3 className="alert-to-siem-forward-block__title">{t("alertToSiem.forwardingTriggersTitle")}</h3>
                  <div className="alert-to-siem-toggle-grid">
                    <SiemOptionToggle
                      checked={forwardOnUpdate}
                      disabled={!canWrite}
                      onChange={setForwardOnUpdate}
                      title={t("alertToSiem.forwardOnUpdateShort")}
                      description={t("alertToSiem.forwardOnUpdateDesc")}
                    />
                    <SiemOptionToggle
                      checked={forwardOnStatusChange}
                      disabled={!canWrite}
                      onChange={setForwardOnStatusChange}
                      title={t("alertToSiem.forwardOnStatusChangeShort")}
                      description={t("alertToSiem.forwardOnStatusChangeDesc")}
                    />
                    <SiemOptionToggle
                      checked={forwardOnlyOpen}
                      disabled={!canWrite}
                      onChange={setForwardOnlyOpen}
                      title={t("alertToSiem.forwardOnlyOpenShort")}
                      description={t("alertToSiem.forwardOnlyOpenDesc")}
                    />
                  </div>
                </section>

                <section className="alert-to-siem-forward-block">
                  <h3 className="alert-to-siem-forward-block__title">{t("alertToSiem.forwardingFiltersTitle")}</h3>
                  <div className="alert-to-siem-filter-bar">
                    <label className="alert-to-siem-filter-bar__item">
                      <span className="alert-to-siem-field__label">{t("alertToSiem.minSeverity")}</span>
                      <select
                        value={minSeverity}
                        disabled={!canWrite}
                        onChange={(e) => setMinSeverity(e.target.value)}
                      >
                        {SEVERITY_OPTIONS.map((s) => (
                          <option key={s || "any"} value={s}>
                            {s ? s : t("alertToSiem.minSeverityAny")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div
                    className={`alert-to-siem-subpanel${forwardOnStatusChange ? "" : " alert-to-siem-subpanel--off"}`}
                  >
                    <div className="alert-to-siem-subpanel__head">
                      <span className="alert-to-siem-field__label">{t("alertToSiem.statusForwardStatuses")}</span>
                      <p className="alert-to-siem-field__hint">{t("alertToSiem.statusForwardStatusesHint")}</p>
                    </div>
                    <div className="alert-to-siem-status-chips">
                      {STATUS_OPTIONS.map((st) => {
                        const active = statusForwardStatuses.includes(st);
                        return (
                          <label
                            key={st}
                            className={`alert-to-siem-chip${active ? " alert-to-siem-chip--active" : ""}${!forwardOnStatusChange ? " alert-to-siem-chip--disabled" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={!canWrite || !forwardOnStatusChange}
                              onChange={() => toggleStatusForward(st)}
                            />
                            <span>{st.replace("_", " ")}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="alert-to-siem-forward-block alert-to-siem-forward-block--scope">
                  <h3 className="alert-to-siem-forward-block__title">{t("alertToSiem.forwardingScopeTitle")}</h3>
                  <div className="alert-to-siem-rule-filters">
                    <label className="alert-to-siem-field">
                      <span className="alert-to-siem-field__label">{t("alertToSiem.ruleIdsInclude")}</span>
                      <textarea
                        rows={4}
                        value={ruleIdsInclude}
                        disabled={!canWrite}
                        placeholder={t("alertToSiem.ruleIdsPlaceholder")}
                        onChange={(e) => setRuleIdsInclude(e.target.value)}
                      />
                      <span className="alert-to-siem-field__hint">{t("alertToSiem.ruleIdsIncludeHint")}</span>
                    </label>
                    <label className="alert-to-siem-field">
                      <span className="alert-to-siem-field__label">{t("alertToSiem.ruleIdsExclude")}</span>
                      <textarea
                        rows={4}
                        value={ruleIdsExclude}
                        disabled={!canWrite}
                        placeholder={t("alertToSiem.ruleIdsPlaceholder")}
                        onChange={(e) => setRuleIdsExclude(e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </OpsPanel>

            <OpsPanel
              id="alert-to-siem-payload"
              theme="purple"
              icon={FileJson}
              title={t("alertToSiem.payloadTitle")}
              hint={t("alertToSiem.payloadSubtitle")}
              className="alert-to-siem-panel alert-to-siem-panel--payload"
            >
              <div className="alert-to-siem-payload-layout">
                <section className="alert-to-siem-payload-block">
                  <h3 className="alert-to-siem-payload-block__title">{t("alertToSiem.payloadContentTitle")}</h3>
                  <div className="alert-to-siem-toggle-grid">
                    <SiemOptionToggle
                      checked={includeSampleEvent}
                      disabled={!canWrite}
                      onChange={setIncludeSampleEvent}
                      title={t("alertToSiem.includeSampleEventShort")}
                      description={t("alertToSiem.includeSampleEventDesc")}
                    />
                    <SiemOptionToggle
                      checked={useAlertTimestamp}
                      disabled={!canWrite}
                      onChange={setUseAlertTimestamp}
                      title={t("alertToSiem.useAlertTimestampShort")}
                      description={t("alertToSiem.useAlertTimestampDesc")}
                    />
                  </div>
                </section>

                <section className="alert-to-siem-payload-block alert-to-siem-payload-block--preview">
                  <h3 className="alert-to-siem-payload-block__title">{t("alertToSiem.payloadPreviewTitle")}</h3>
                  <p className="alert-to-siem-payload-block__hint">{t("alertToSiem.payloadPreviewHint")}</p>
                  <pre className="alert-to-siem-payload-preview" aria-label={t("alertToSiem.payloadPreviewTitle")}>
                    <code>{payloadPreview.text}</code>
                  </pre>
                </section>

                <section className="alert-to-siem-payload-block alert-to-siem-payload-block--editor">
                  <div className="alert-to-siem-json-editor__head">
                    <h3 className="alert-to-siem-payload-block__title">{t("alertToSiem.payloadExtrasTitle")}</h3>
                    {canWrite && (
                      <Button type="button" variant="ghost" size="sm" onClick={resetExtraFields}>
                        {t("alertToSiem.extraFieldsReset")}
                      </Button>
                    )}
                  </div>
                  <p className="alert-to-siem-payload-block__hint">{t("alertToSiem.extraFieldsHint")}</p>
                  <textarea
                    rows={8}
                    className={`alert-to-siem-json-input${!payloadPreview.extraValid ? " alert-to-siem-json-input--invalid" : ""}`}
                    value={extraFieldsJson}
                    disabled={!canWrite}
                    spellCheck={false}
                    onChange={(e) => setExtraFieldsJson(e.target.value)}
                    aria-invalid={!payloadPreview.extraValid}
                  />
                  {!payloadPreview.extraValid && (
                    <p className="alert-to-siem-json-editor__error">{t("alertToSiem.extraFieldsInvalid")}</p>
                  )}
                </section>
              </div>

              <div className="alert-to-siem-payload-footer">
                {canWrite && (
                  <div className="alert-to-siem-action-bar">
                    <Button type="button" disabled={saving} onClick={() => void save()}>
                      {saving ? t("common.saving") : t("common.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={testing}
                      onClick={() => void testConnection()}
                    >
                      <Share2 size={14} aria-hidden />
                      {testing ? t("alertToSiem.testing") : t("alertToSiem.test")}
                    </Button>
                  </div>
                )}

                {(msg || testMsg) && (
                  <div className="alert-to-siem-feedback">
                    {msg && (
                      <p
                        className={
                          msg.includes("saved") || msg.includes("enregistr") || msg.includes("保存")
                            ? "alert-to-siem-feedback--ok"
                            : undefined
                        }
                      >
                        {msg}
                      </p>
                    )}
                    {testMsg && (
                      <p
                        className={
                          testMsg.toLowerCase().includes("accepted") ||
                          testMsg.toLowerCase().includes("test")
                            ? "alert-to-siem-feedback--ok"
                            : "alert-to-siem-feedback--err"
                        }
                      >
                        {testMsg}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </OpsPanel>
          </div>

          <OpsPanel
            id="alert-to-siem-logs"
            theme="green"
            icon={ScrollText}
            title={t("alertToSiem.logsTitle")}
            hint={t("alertToSiem.logsSubtitle")}
            className="alert-to-siem-panel alert-to-siem-logs-panel"
          >
            {logs.length === 0 ? (
              <EmptyState title={t("alertToSiem.logsEmpty")} description={t("alertToSiem.logsEmptyHint")} />
            ) : (
              <CompactDataTable wrapClassName="alert-to-siem-log-table-wrap">
                <thead>
                  <tr>
                    <th>{t("alertToSiem.colTime")}</th>
                    <th>{t("alertToSiem.colKind")}</th>
                    <th>{t("alertToSiem.colAlert")}</th>
                    <th>{t("alertToSiem.colRule")}</th>
                    <th>{t("alertToSiem.colStatus")}</th>
                    <th>{t("alertToSiem.colHttp")}</th>
                    <th>{t("alertToSiem.colDestination")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs">{new Date(row.created_at).toLocaleString()}</td>
                      <td>
                        <span className={`alert-to-siem-kind alert-to-siem-kind--${row.event_kind}`}>
                          {row.event_kind}
                        </span>
                      </td>
                      <td>
                        {row.alert_id ? (
                          <Link to={`/alerts?highlight=${row.alert_id}`}>{row.alert_id.slice(0, 8)}…</Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-sm">{row.payload_summary.rule_name ?? "—"}</td>
                      <td>
                        <span
                          className={
                            row.status === "success"
                              ? "alert-to-siem-status alert-to-siem-status--ok"
                              : "alert-to-siem-status alert-to-siem-status--err"
                          }
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{row.http_status ?? "—"}</td>
                      <td className="text-xs truncate-cell" title={row.destination}>
                        {row.destination}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CompactDataTable>
            )}
          </OpsPanel>
        </div>
      )}
    </div>
  );
}
