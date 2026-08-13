import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import { IronSiftConfigProfilesBar } from "@/components/ironsift/ConfigProfilesBar";
import { IronSiftConfigSaveBar } from "@/components/ironsift/IronSiftConfigSaveBar";
import { mergeEndpointIngestConfig, type IronSiftPlatformConfig } from "@/lib/ironsift";
import { EndpointDeviceRuleFields } from "@/components/ironsift/EndpointDeviceRuleFields";
import {
  DEFAULT_DETECTION_CONFIG,
  deleteConfigPreset,
  downloadConfigFile,
  listConfigPresets,
  mergeDetectionDefaults,
  parseImportedConfig,
  saveConfigPreset,
  type IronSiftConfigPreset,
} from "@/lib/ironsiftConfigPresets";

function num(v: unknown, fallback: number) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean);
}

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

function nested(dc: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = dc[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function detectionBool(detection: Record<string, unknown>, key: string): boolean {
  const v = detection[key];
  if (typeof v === "boolean") return v;
  const d = DEFAULT_DETECTION_CONFIG[key];
  return typeof d === "boolean" ? d : false;
}

function detectionNum(detection: Record<string, unknown>, key: string): number {
  const d = DEFAULT_DETECTION_CONFIG[key];
  const fallback = typeof d === "number" ? d : 0;
  return num(detection[key], fallback);
}

function detectionFrmtNum(
  frmt: Record<string, unknown>,
  key: string
): number {
  const defaults = nested(DEFAULT_DETECTION_CONFIG, "file_recent_mtime");
  const d = defaults[key];
  const fallback = typeof d === "number" ? d : 0;
  return num(frmt[key], fallback);
}

function ConfigSection({
  title,
  startOpen = false,
  nested: isNested = false,
  className = "",
  children,
}: {
  title: string;
  startOpen?: boolean;
  nested?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (startOpen && ref.current) ref.current.open = true;
  }, [startOpen]);

  return (
    <details
      ref={ref}
      className={`ironsift-config-section${isNested ? " ironsift-config-section--nested" : ""}${className ? ` ${className}` : ""}`}
    >
      <summary>{title}</summary>
      <div className="ironsift-config-section__body">{children}</div>
    </details>
  );
}

function normalizeIronSiftConfig(cfg: IronSiftPlatformConfig): IronSiftPlatformConfig {
  const { anomark_config: _omit, ...rest } = cfg;
  return {
    ...rest,
    endpoint_ingest: mergeEndpointIngestConfig(rest.endpoint_ingest),
    detection_config: mergeDetectionDefaults(rest.detection_config ?? {}),
  };
}

export function buildDetectionConfigFromState(
  dc: Record<string, unknown>,
  rawJson: string
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return mergeDetectionDefaults({ ...parsed, ...dc });
  } catch {
    return mergeDetectionDefaults(dc);
  }
}

type FormProps = {
  platform: IronSiftPlatformConfig;
  detection: Record<string, unknown>;
  rawJson: string;
  canEdit: boolean;
  showPlatform: boolean;
  showPresets: boolean;
  expandDetectionSections?: boolean;
  hint?: string;
  error: string;
  onPlatformChange: (patch: Partial<IronSiftPlatformConfig>) => void;
  onDetectionChange: (next: Record<string, unknown>) => void;
  onRawJsonChange: (v: string) => void;
  onApplyRaw: () => void;
  onLoadPreset: (preset: IronSiftConfigPreset) => void;
};

function ConfigForm({
  platform,
  detection,
  rawJson,
  canEdit,
  showPlatform,
  showPresets,
  expandDetectionSections = false,
  hint,
  error,
  onPlatformChange,
  onDetectionChange,
  onRawJsonChange,
  onApplyRaw,
  onLoadPreset,
}: FormProps) {
  const { t } = useLocale();
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [presetId, setPresetId] = useState("");
  const [presets, setPresets] = useState<IronSiftConfigPreset[]>(() => listConfigPresets());

  const frmt = nested(detection, "file_recent_mtime");

  function patchDc(patch: Record<string, unknown>) {
    onDetectionChange({ ...detection, ...patch });
  }

  function patchFrmt(patch: Record<string, unknown>) {
    onDetectionChange({
      ...detection,
      file_recent_mtime: { ...frmt, ...patch },
    });
  }

  function refreshPresets() {
    setPresets(listConfigPresets());
  }

  function loadSelectedPreset() {
    const p = presets.find((x) => x.id === presetId);
    if (p) onLoadPreset(p);
  }

  function saveAsPreset() {
    const name = window.prompt(t("ironsift.configPresetNamePrompt"));
    if (!name?.trim()) return;
    saveConfigPreset(name, detection);
    refreshPresets();
  }

  function removePreset() {
    const p = presets.find((x) => x.id === presetId);
    if (!p || p.builtIn) return;
    if (!window.confirm(t("ironsift.configPresetDeleteConfirm", { name: p.name }))) return;
    deleteConfigPreset(p.id);
    setPresetId("");
    refreshPresets();
  }

  function exportFile() {
    downloadConfigFile(platform);
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = parseImportedConfig(String(reader.result ?? ""));
        if (showPlatform) {
          onPlatformChange(cfg);
        }
        onDetectionChange(mergeDetectionDefaults(cfg.detection_config ?? {}));
        onRawJsonChange(JSON.stringify(mergeDetectionDefaults(cfg.detection_config ?? {}), null, 2));
      } catch (e) {
        alert(parseIronSiftError(e));
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="ironsift-config-editor">
      {hint ? <p className="muted text-xs">{hint}</p> : null}
      {showPresets && (
        <div className="ironsift-config-presets">
          <label className="ironsift-config-field ironsift-config-field--profile">
            <span className="muted text-xs">{t("ironsift.configPresetLabel")}</span>
            <select
              className="mono"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">{t("ironsift.configPresetPick")}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.builtIn ? ` (${t("ironsift.configPresetBuiltIn")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" disabled={!presetId} onClick={loadSelectedPreset}>
            {t("ironsift.configPresetLoad")}
          </Button>
          {canEdit && (
            <>
              <Button variant="secondary" onClick={saveAsPreset}>
                {t("ironsift.configPresetSave")}
              </Button>
              <Button
                variant="secondary"
                disabled={!presetId || presets.find((p) => p.id === presetId)?.builtIn}
                onClick={removePreset}
              >
                {t("ironsift.configPresetDelete")}
              </Button>
              <Button variant="secondary" onClick={exportFile}>
                {t("ironsift.configExport")}
              </Button>
              <Button variant="secondary" onClick={() => fileImportRef.current?.click()}>
                {t("ironsift.configImport")}
              </Button>
              <input
                ref={fileImportRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}

      {showPlatform && (
        <ConfigSection title={t("ironsift.configPlatformTitle")} startOpen>
          <div className="ironsift-config-platform">
            <div className="ironsift-config-platform-toggles">
              <label className="ironsift-config-check">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={platform.enabled}
                  onChange={(e) => onPlatformChange({ enabled: e.target.checked })}
                />
                <span className="mono text-xs">enabled</span>
              </label>
              <label className="ironsift-config-check">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={platform.post_ingest_temporal}
                  onChange={(e) => onPlatformChange({ post_ingest_temporal: e.target.checked })}
                />
                <span className="mono text-xs">post_ingest_temporal</span>
              </label>
            </div>
            <p className="muted text-xs ironsift-config-plugin-hint">{t("plugins.ironsiftHint")}</p>
            <div className="ironsift-config-grid ironsift-config-grid--platform-fields">
              <label className="ironsift-config-field">
                <span className="muted text-xs mono">min_fleet_devices</span>
                <input
                  type="number"
                  className="mono"
                  disabled={!canEdit}
                  min={1}
                  value={platform.min_fleet_devices}
                  onChange={(e) => onPlatformChange({ min_fleet_devices: Number(e.target.value) })}
                />
              </label>
              <label className="ironsift-config-field">
                <span className="muted text-xs mono">min_score</span>
                <input
                  type="number"
                  className="mono"
                  disabled={!canEdit}
                  step={0.05}
                  min={0}
                  max={1}
                  value={platform.min_score}
                  onChange={(e) => onPlatformChange({ min_score: Number(e.target.value) })}
                />
              </label>
              <label className="ironsift-config-field">
                <span className="muted text-xs mono">fleet_cron</span>
                <input
                  className="mono"
                  disabled={!canEdit}
                  value={platform.fleet_cron}
                  onChange={(e) => onPlatformChange({ fleet_cron: e.target.value })}
                />
              </label>
              <label className="ironsift-config-field">
                <span className="muted text-xs mono">mudm_platform</span>
                <input
                  className="mono"
                  disabled={!canEdit}
                  value={platform.mudm_platform}
                  onChange={(e) => onPlatformChange({ mudm_platform: e.target.value })}
                />
              </label>
            </div>
          </div>
        </ConfigSection>
      )}

      <ConfigSection title={t("ironsift.configEndpointIngestTitle")} startOpen>
        <EndpointDeviceRuleFields
          value={platform.endpoint_ingest ?? {}}
          canEdit={canEdit}
          onChange={(endpoint_ingest) => onPlatformChange({ endpoint_ingest })}
        />
      </ConfigSection>

      <ConfigSection title={t("ironsift.configClusterTitle")} startOpen>
        <div className="ironsift-config-grid">
          {(
            [
              ["entropy_threshold", 0.01],
              ["minority_cluster_ratio", 0.01],
              ["dbscan_tolerance", 0.01],
              ["dbscan_min_samples", 1],
            ] as const
          ).map(([key, step]) => (
            <label key={key} className="ironsift-config-field">
              <span className="muted text-xs mono">{key}</span>
              <input
                type="number"
                className="mono"
                disabled={!canEdit}
                step={step}
                value={num(detection[key], 0)}
                onChange={(e) => patchDc({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="ironsift-config-check">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={bool(detection.normalize_features, true)}
              onChange={(e) => patchDc({ normalize_features: e.target.checked })}
            />
            <span className="mono text-xs">normalize_features</span>
          </label>
        </div>
      </ConfigSection>

      <ConfigSection title={t("ironsift.configProcessTitle")} startOpen>
        <div className="ironsift-config-grid ironsift-config-grid--checks">
          {(
            [
              "exclude_kernel_threads",
              "exclude_init_children",
              "flag_unexpected_root",
              "debug_display",
              "quiet",
            ] as const
          ).map((key) => (
            <label key={key} className="ironsift-config-check">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={bool(detection[key], key === "exclude_kernel_threads")}
                onChange={(e) => patchDc({ [key]: e.target.checked })}
              />
              <span className="mono text-xs">{key}</span>
            </label>
          ))}
        </div>
      </ConfigSection>

      <ConfigSection title={t("ironsift.configListsTitle")} startOpen={!!expandDetectionSections}>
        {(
          [
            ["suspicious_path_patterns", t("ironsift.configSuspiciousPaths")],
            ["common_root_processes", t("ironsift.configRootProcesses")],
            ["whitelisted_path_patterns", t("ironsift.configWhitelistPaths")],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="ironsift-config-list-field">
            <span className="muted text-xs">{label}</span>
            <textarea
              className="mono"
              rows={4}
              disabled={!canEdit}
              value={listToLines(strList(detection[key]))}
              onChange={(e) => patchDc({ [key]: linesToList(e.target.value) })}
            />
          </label>
        ))}
      </ConfigSection>

      <ConfigSection title={t("ironsift.configFileTitle")} startOpen={!!expandDetectionSections}>
        <div className="ironsift-config-grid ironsift-config-grid--file-checks">
          {(
            [
              "file_rare_signature_includes_size",
              "file_rare_signature_includes_metadata",
              "file_rare_signature_includes_recent_mtime",
              "file_rare_requires_risk",
              "file_fleet_baseline_fingerprint_enabled",
              "file_fleet_baseline_exclude_suspicious_paths",
              "file_exclude_common_inventory_sql",
            ] as const
          ).map((key) => (
            <label key={key} className="ironsift-config-check ironsift-config-check--wide">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={detectionBool(detection, key)}
                onChange={(e) => patchDc({ [key]: e.target.checked })}
              />
              <span className="mono text-xs">{key}</span>
            </label>
          ))}
        </div>
        <div className="ironsift-config-grid ironsift-config-grid--file-numbers">
          {(
            [
              "file_max_rare_examples_per_host",
              "file_max_unique_features",
              "file_fleet_baseline_min_host_fraction",
              "file_fleet_baseline_mtime_bucket_secs",
            ] as const
          ).map((key) => (
            <label key={key} className="ironsift-config-field">
              <span className="muted text-xs mono">{key}</span>
              <input
                type="number"
                className="mono"
                disabled={!canEdit}
                step={key.includes("fraction") ? 0.01 : 1}
                value={detectionNum(detection, key)}
                onChange={(e) => patchDc({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        {(
          [
            ["file_excluded_path_regexes", t("ironsift.configFilePathRx")],
            ["file_excluded_filename_regexes", t("ironsift.configFileNameRx")],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="ironsift-config-list-field ironsift-config-list-field--wide">
            <span className="muted text-xs">{label}</span>
            <textarea
              className="mono"
              rows={3}
              disabled={!canEdit}
              value={listToLines(strList(detection[key]))}
              onChange={(e) => patchDc({ [key]: linesToList(e.target.value) })}
            />
          </label>
        ))}
        <ConfigSection
          title={t("ironsift.configFileMtimeTitle")}
          startOpen={!!expandDetectionSections}
          nested
        >
          <div className="ironsift-config-grid">
            {(
              [
                "clock_skew_minutes",
                "max_hours_critical_paths",
                "max_hours_system_elevated",
                "max_hours_suspicious_only",
              ] as const
            ).map((key) => (
              <label key={key} className="ironsift-config-field">
                <span className="muted text-xs mono">{key}</span>
                <input
                  type="number"
                  className="mono"
                  disabled={!canEdit}
                  value={detectionFrmtNum(frmt, key)}
                  onChange={(e) => patchFrmt({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <label className="ironsift-config-list-field ironsift-config-list-field--wide">
            <span className="muted text-xs">{t("ironsift.configVolatilePrefixes")}</span>
            <textarea
              className="mono"
              rows={4}
              disabled={!canEdit}
              value={listToLines(strList(frmt.volatile_path_prefixes))}
              onChange={(e) => patchFrmt({ volatile_path_prefixes: linesToList(e.target.value) })}
            />
          </label>
        </ConfigSection>
      </ConfigSection>

      <ConfigSection title={t("ironsift.configRaw")}>
        <textarea
          className="mono ironsift-config-raw"
          rows={10}
          disabled={!canEdit}
          value={rawJson}
          onChange={(e) => onRawJsonChange(e.target.value)}
        />
        <Button variant="secondary" disabled={!canEdit} onClick={onApplyRaw}>
          {t("ironsift.configApplyRaw")}
        </Button>
      </ConfigSection>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function DetectionConfigEditor({
  config,
  canWrite,
  expandDetectionSections = false,
  onSave,
  onSaved,
  onReload,
  onProfileSuccess,
  onError,
}: {
  config: IronSiftPlatformConfig;
  canWrite: boolean;
  expandDetectionSections?: boolean;
  onSave: (cfg: IronSiftPlatformConfig) => Promise<void>;
  onSaved?: () => void;
  onReload?: () => void | Promise<void>;
  onProfileSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useLocale();
  const [platform, setPlatform] = useState(config);
  const [detection, setDetection] = useState<Record<string, unknown>>(() =>
    mergeDetectionDefaults(config.detection_config ?? {})
  );
  const [rawJson, setRawJson] = useState(() =>
    JSON.stringify(mergeDetectionDefaults(config.detection_config ?? {}), null, 2)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPlatform({
      ...config,
      endpoint_ingest: mergeEndpointIngestConfig(config.endpoint_ingest),
    });
    const dc = mergeDetectionDefaults(config.detection_config ?? {});
    setDetection(dc);
    setRawJson(JSON.stringify(dc, null, 2));
  }, [config]);

  function applyRaw() {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const merged = mergeDetectionDefaults(parsed);
      setDetection(merged);
      setRawJson(JSON.stringify(merged, null, 2));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  function loadPreset(preset: IronSiftConfigPreset) {
    const dc = mergeDetectionDefaults(preset.detection_config);
    setDetection(dc);
    setRawJson(JSON.stringify(dc, null, 2));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const detection_config = buildDetectionConfigFromState(detection, rawJson);
      const { anomark_config: _omit, ...ironsiftOnly } = platform;
      await onSave({ ...ironsiftOnly, detection_config });
      setRawJson(JSON.stringify(detection_config, null, 2));
      onSaved?.();
    } catch (e) {
      const msg = parseIronSiftError(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  function currentConfig(): IronSiftPlatformConfig {
    const detection_config = buildDetectionConfigFromState(detection, rawJson);
    const { anomark_config: _omit, ...ironsiftOnly } = platform;
    return { ...ironsiftOnly, detection_config };
  }

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(normalizeIronSiftConfig(currentConfig())) !==
      JSON.stringify(normalizeIronSiftConfig(config))
    );
  }, [platform, detection, rawJson, config]);

  return (
    <>
      <IronSiftConfigProfilesBar
        canWrite={canWrite}
        getCurrentConfig={currentConfig}
        onApplied={onReload ?? onSaved ?? (() => {})}
        onError={onError}
        onSuccess={onProfileSuccess}
      />
      <IronSiftConfigSaveBar
        canWrite={canWrite}
        isDirty={isDirty}
        busy={busy}
        saveLabel={t("ironsift.configIronSiftSave")}
        onSave={() => void save()}
      />
      <p className="muted text-xs">{t("ironsift.configIronSiftHint")}</p>
      <ConfigForm
        platform={platform}
        detection={detection}
        rawJson={rawJson}
        canEdit={canWrite}
        showPlatform
        showPresets
        expandDetectionSections={expandDetectionSections}
        error={error}
        onPlatformChange={(patch) => setPlatform((p) => ({ ...p, ...patch }))}
        onDetectionChange={(next) => {
          setDetection(next);
          setRawJson(JSON.stringify(next, null, 2));
        }}
        onRawJsonChange={setRawJson}
        onApplyRaw={applyRaw}
        onLoadPreset={loadPreset}
      />
    </>
  );
}

export function RunDetectionConfigEditor({
  config,
  canEdit,
  onChange,
}: {
  config: IronSiftPlatformConfig;
  canEdit: boolean;
  onChange: (detection_config: Record<string, unknown>) => void;
}) {
  const { t } = useLocale();
  const [detection, setDetection] = useState<Record<string, unknown>>(() =>
    mergeDetectionDefaults(config.detection_config ?? {})
  );
  const [rawJson, setRawJson] = useState(() =>
    JSON.stringify(mergeDetectionDefaults(config.detection_config ?? {}), null, 2)
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const dc = mergeDetectionDefaults(config.detection_config ?? {});
    setDetection(dc);
    setRawJson(JSON.stringify(dc, null, 2));
  }, [config]);

  useEffect(() => {
    onChange(buildDetectionConfigFromState(detection, rawJson));
  }, [detection, rawJson, onChange]);

  function applyRaw() {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const merged = mergeDetectionDefaults(parsed);
      setDetection(merged);
      setRawJson(JSON.stringify(merged, null, 2));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <ConfigForm
      platform={config}
      detection={detection}
      rawJson={rawJson}
      canEdit={canEdit}
      showPlatform={false}
      showPresets
      error={error}
      hint={t("ironsift.runConfigHint")}
      onPlatformChange={() => {}}
      onDetectionChange={(next) => {
        setDetection(next);
        setRawJson(JSON.stringify(next, null, 2));
      }}
      onRawJsonChange={setRawJson}
      onApplyRaw={applyRaw}
      onLoadPreset={(preset) => {
        const dc = mergeDetectionDefaults(preset.detection_config);
        setDetection(dc);
        setRawJson(JSON.stringify(dc, null, 2));
      }}
    />
  );
}

// Back-compat exports used elsewhere
export type DetectionFields = Record<string, unknown>;
export const DETECTION_DEFAULTS = {};
export function detectionFieldsFromConfig(raw: Record<string, unknown>) {
  return raw;
}
export function buildDetectionConfig(
  fields: Record<string, unknown>,
  rawJson: string,
  fallback: Record<string, unknown>
) {
  return buildDetectionConfigFromState({ ...fallback, ...fields }, rawJson);
}
