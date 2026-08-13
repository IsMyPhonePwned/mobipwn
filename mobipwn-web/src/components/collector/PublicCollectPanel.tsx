import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, FolderDown, Smartphone, Trash2, Upload, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AndroidIcon, AppleIcon } from "@/components/icons/PlatformIcons";
import { useLocale } from "@/contexts/LocaleContext";
import { randomCaseSource } from "@/lib/caseSource";
import {
  fetchPublicCollectStatus,
  uploadPublicCollect,
  type PublicCollectIngestResponse,
} from "@/lib/publicCollect";
import { collectBugreportFromDevice, collectMagpieOnlyFromDevice, webUsbSupported, webadbWasmAvailable } from "@/lib/webadb";
import {
  DEFAULT_MAGPIE_COMMANDS,
  magpieBinaryAvailable,
  normalizeFindPaths,
  toggleMagpieCommand,
  type MagpieCommand,
} from "@/lib/androidCollector";
import { fetchPublicCollectorConfig, type PublicCollectorConfig } from "@/lib/collectorConfig";
import { DEFAULT_ANDROID_DEVICE_PATHS, normalizeConfigCommands } from "@/lib/androidCollectConfig";
import { pullRepositoriesToBlobStore } from "@/lib/androidPull";
import { IosWebUsbCollectSection } from "@/components/collector/IosWebUsbCollectSection";
import { SysdiagnoseIngestOptionsFields } from "@/components/ingest/SysdiagnoseIngestOptionsFields";
import {
  DEFAULT_SYSDIAGNOSE_INGEST_CONFIG,
  type SysdiagnoseIngestConfig,
} from "@/components/settings/SettingsSysdiagnoseIngestSection";

type CollectPlatform = "android" | "ios";

type LogLine = { id: number; time: string; text: string };

type Props = {
  /** When true, render inside the main app shell (Collector plugin page). */
  embedded?: boolean;
  onOpenSettings?: () => void;
  onOpenYara?: () => void;
};

function nowLabel(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const COMMAND_LABELS: Record<MagpieCommand, string> = {
  find: "find — file inventory",
  ps: "ps — process list",
  yara: "yara — on-device scan",
};

function CollectPathList({
  paths,
  onChange,
  disabled,
  placeholder,
  allowEmpty = false,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  disabled: boolean;
  placeholder: string;
  allowEmpty?: boolean;
}) {
  return (
    <ul className="public-collect__magpie-path-list">
      {paths.length === 0 ? (
        <li className="muted text-xs">{placeholder}</li>
      ) : (
        paths.map((path, index) => (
          <li key={index} className="public-collect__magpie-path-row">
            <input
              className="mono"
              value={path}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(e) =>
                onChange(paths.map((p, i) => (i === index ? e.target.value : p)))
              }
            />
            <button
              type="button"
              className="public-collect__magpie-remove"
              disabled={disabled || (!allowEmpty && paths.length <= 1)}
              aria-label={`Remove path ${index + 1}`}
              onClick={() => onChange(paths.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

export function PublicCollectPanel({ embedded = false, onOpenSettings, onOpenYara }: Props) {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [source, setSource] = useState(() => randomCaseSource());
  const [deviceUser, setDeviceUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublicCollectIngestResponse | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logId = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [magpieEnabled, setMagpieEnabled] = useState(false);
  const [collectorCfg, setCollectorCfg] = useState<PublicCollectorConfig | null>(null);
  const [magpieReady, setMagpieReady] = useState<boolean | null>(null);
  const [webadbReady, setWebadbReady] = useState<boolean | null>(null);
  const [sessionCommands, setSessionCommands] = useState<MagpieCommand[]>(DEFAULT_MAGPIE_COMMANDS);
  const [sessionFindPaths, setSessionFindPaths] = useState<string[]>([...DEFAULT_ANDROID_DEVICE_PATHS]);
  const [sessionYaraPaths, setSessionYaraPaths] = useState<string[]>([...DEFAULT_ANDROID_DEVICE_PATHS]);
  const [sessionMaxDepth, setSessionMaxDepth] = useState(3);
  const [sessionYaraMaxDepth, setSessionYaraMaxDepth] = useState(3);
  const [sessionPullPaths, setSessionPullPaths] = useState<string[]>([]);
  const [pullSummary, setPullSummary] = useState("");
  const [sysdiagnoseOpts, setSysdiagnoseOpts] = useState<SysdiagnoseIngestConfig>(
    DEFAULT_SYSDIAGNOSE_INGEST_CONFIG
  );

  const appendLog = useCallback((text: string) => {
    const id = ++logId.current;
    setLogs((prev) => [...prev, { id, time: nowLabel(), text }]);
  }, []);

  useEffect(() => {
    fetchPublicCollectStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!embedded) return;
    const refresh = () => {
      fetchPublicCollectStatus()
        .then((s) => setEnabled(s.enabled))
        .catch(() => setEnabled(false));
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [embedded]);

  useEffect(() => {
    magpieBinaryAvailable()
      .then(setMagpieReady)
      .catch(() => setMagpieReady(false));
  }, []);

  useEffect(() => {
    webadbWasmAvailable()
      .then(setWebadbReady)
      .catch(() => setWebadbReady(false));
  }, []);

  useEffect(() => {
    fetchPublicCollectorConfig()
      .then((cfg) => {
        setCollectorCfg(cfg);
        const android = cfg.android;
        const commands = normalizeConfigCommands(android.default_commands);
        setSessionCommands(commands);
        setSessionFindPaths(
          android.find_paths.length > 0 ? [...android.find_paths] : [...DEFAULT_ANDROID_DEVICE_PATHS]
        );
        const defaultYaraPaths =
          android.yara_paths.length > 0
            ? android.yara_paths
            : android.find_paths.length > 0
              ? android.find_paths
              : [...DEFAULT_ANDROID_DEVICE_PATHS];
        setSessionYaraPaths([...defaultYaraPaths]);
        setSessionMaxDepth(android.max_depth ?? 3);
        setSessionYaraMaxDepth(android.yara_max_depth ?? android.max_depth ?? 3);
        const configuredPullPaths = android.pull_repository_paths?.filter(Boolean) ?? [];
        setSessionPullPaths(
          configuredPullPaths.length > 0 ? [...configuredPullPaths] : [...DEFAULT_ANDROID_DEVICE_PATHS]
        );
        if (commands.length > 0) setMagpieEnabled(true);
        if (cfg.sysdiagnose) {
          setSysdiagnoseOpts({
            logarchive_decode_max_lines:
              typeof cfg.sysdiagnose.logarchive_decode_max_lines === "number"
                ? cfg.sysdiagnose.logarchive_decode_max_lines
                : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.logarchive_decode_max_lines,
            ioservice_full_tree: Boolean(cfg.sysdiagnose.ioservice_full_tree),
            logarchive_uncapped: Boolean(cfg.sysdiagnose.logarchive_uncapped),
            max_entry_mb:
              typeof cfg.sysdiagnose.max_entry_mb === "number"
                ? cfg.sysdiagnose.max_entry_mb
                : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.max_entry_mb,
          });
        }
      })
      .catch(() => {
        /* keep local defaults */
      });
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const android = collectorCfg?.android;
  const magpieCommands = sessionCommands;
  const magpieFindPaths = sessionFindPaths;
  const magpieMaxDepth = sessionMaxDepth;
  const magpieYaraPaths = sessionYaraPaths;
  const magpieYaraMaxDepth = sessionYaraMaxDepth;
  const magpieHashFiles = android?.hash_files ?? false;
  const magpieMaxHashSize = android?.max_hash_size ?? 512 * 1024;
  const magpieExcludeDirs = android?.exclude_dirs ?? [];
  const magpieYaraRulesB64 = android?.yara_bundle_b64 ?? undefined;
  const magpieYaraRuleNames = android?.yara_rule_names ?? [];
  const activePullPaths = sessionPullPaths.map((p) => p.trim()).filter(Boolean);
  const pullMaxDepth = android?.pull_max_depth ?? 5;
  const pullMaxFileSize = android?.pull_max_file_size ?? 50 * 1024 * 1024;
  const pullMaxFiles = android?.pull_max_files ?? 500;
  const iosUploadEnabled = collectorCfg?.ios.upload_enabled ?? true;
  const iosInstructions = collectorCfg?.ios.instructions ?? "";
  const requestedPlatform: CollectPlatform =
    searchParams.get("platform") === "ios" ? "ios" : "android";
  const platform: CollectPlatform =
    requestedPlatform === "ios" && !iosUploadEnabled ? "android" : requestedPlatform;

  const setPlatform = (next: CollectPlatform) => {
    if (next === "ios" && !iosUploadEnabled) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "android") params.delete("platform");
        else params.set("platform", next);
        return params;
      },
      { replace: true }
    );
  };

  const magpieOptions = {
    commands: magpieCommands,
    findPaths: normalizeFindPaths(magpieFindPaths),
    maxDepth: magpieMaxDepth,
    hashFiles: magpieHashFiles,
    maxHashSize: magpieMaxHashSize,
    excludeDirs: magpieExcludeDirs,
    yaraPaths: normalizeFindPaths(magpieYaraPaths),
    yaraMaxDepth: magpieYaraMaxDepth,
    yaraRulesB64: magpieYaraRulesB64,
  };

  const pushToSiem = async (platform: "android" | "ios", data: Blob, label: string) => {
    setBusy(true);
    setError("");
    setResult(null);
    appendLog(`Uploading ${label} to SIEM (${(data.size / (1024 * 1024)).toFixed(1)} MB)…`);
    try {
      const resp = await uploadPublicCollect({
        platform,
        source,
        user: deviceUser || undefined,
        data,
        sysdiagnose:
          platform === "ios"
            ? {
                logarchive_uncapped: sysdiagnoseOpts.logarchive_uncapped,
                logarchive_decode_max_lines: sysdiagnoseOpts.logarchive_decode_max_lines,
                max_entry_mb: sysdiagnoseOpts.max_entry_mb,
                ioservice_full_tree: sysdiagnoseOpts.ioservice_full_tree,
              }
            : undefined,
      });
      setResult(resp);
      appendLog(
        `Ingest complete — ${resp.ingested.toLocaleString()} events, case “${resp.case_title}”.`
      );
    } catch (e) {
      const msg = String(e);
      setError(msg);
      appendLog(`Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const magpieResultLabel = (
    processCount: number,
    fileCount: number,
    yaraMatchCount: number
  ) => {
    const parts: string[] = [];
    if (magpieCommands.includes("ps")) parts.push(`${processCount} processes`);
    if (magpieCommands.includes("find")) parts.push(`${fileCount} files`);
    if (magpieCommands.includes("yara")) parts.push(`${yaraMatchCount} YARA hits`);
    return parts.join(", ");
  };

  const collectViaWebUsb = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    appendLog(
      magpieEnabled
        ? "Starting WebUSB collection (bugreport + Rusty Magpie)…"
        : "Starting WebUSB bugreport collection…"
    );
    try {
      const { data, magpie } = await collectBugreportFromDevice(appendLog, {
        magpie: magpieEnabled ? magpieOptions : undefined,
      });
      const blob = new Blob([data], { type: "application/zip" });
      const label = magpie
        ? `Android bugreport + Magpie (${magpieResultLabel(magpie.processCount, magpie.fileCount, magpie.yaraMatchCount)})`
        : "Android bugreport";
      await pushToSiem("android", blob, label);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      appendLog(`Error: ${msg}`);
      setBusy(false);
    }
  };

  const collectMagpieOnlyViaWebUsb = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    appendLog("Starting WebUSB Rusty Magpie collection (no bugreport)…");
    try {
      const { data, magpie } = await collectMagpieOnlyFromDevice(appendLog, magpieOptions);
      const blob = new Blob([data], { type: "application/zip" });
      const label = `Rusty Magpie (${magpieResultLabel(magpie.processCount, magpie.fileCount, magpie.yaraMatchCount)})`;
      await pushToSiem("android", blob, label);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      appendLog(`Error: ${msg}`);
      setBusy(false);
    }
  };

  const collectRepositoriesViaWebUsb = async () => {
    if (activePullPaths.length === 0) {
      appendLog(t("collector.pullNoPaths"));
      return;
    }
    setBusy(true);
    setError("");
    setPullSummary("");
    appendLog(t("collector.pullStarting"));
    try {
      const result = await pullRepositoriesToBlobStore(
        {
          repositories: activePullPaths,
          maxDepth: pullMaxDepth,
          maxFileSize: pullMaxFileSize,
          maxFiles: pullMaxFiles,
          source: source.trim() || randomCaseSource(),
          user: deviceUser.trim() || undefined,
          storeMode: embedded ? "auth" : "public",
        },
        appendLog
      );
      setPullSummary(
        t("collector.pullSummary", {
          stored: String(result.stored),
          skipped: String(result.skipped),
          errors: String(result.errors),
        })
      );
    } catch (e) {
      const msg = String(e);
      setError(msg);
      appendLog(`Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const onFileUpload = async (platform: "android" | "ios", file: File | null) => {
    if (!file || busy) return;
    await pushToSiem(platform, file, file.name);
  };

  const settingsHint = (label: string) => {
    if (embedded && onOpenSettings) {
      return (
        <button type="button" className="link-btn" onClick={onOpenSettings}>
          {label}
        </button>
      );
    }
    if (embedded) {
      return <span>{label}</span>;
    }
    return null;
  };

  const yaraHint = (label: string) => {
    if (embedded && onOpenYara) {
      return (
        <button type="button" className="link-btn" onClick={onOpenYara}>
          {label}
        </button>
      );
    }
    return settingsHint(label);
  };

  if (enabled === null) {
    return <p className="muted p-4">{t("common.loading")}</p>;
  }

  if (!enabled) {
    return (
      <div className="card public-collect__disabled-panel">
        <p className="public-collect__disabled">
          {embedded
            ? t("collector.disabledInApp")
            : t("collector.disabledPublic")}
        </p>
      </div>
    );
  }

  const panelBody = (
    <>
      <main className="public-collect__grid">
        <section className="card public-collect__panel public-collect__meta">
          <h2 className="public-collect__section-title">{t("collector.caseLabelTitle")}</h2>
          <div className="public-collect__meta-fields">
            <label className="public-collect__field">
              <span className="text-xs muted">{t("collector.sourceLabel")}</span>
              <input
                className="mono"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="public-collect__field">
              <span className="text-xs muted">{t("collector.deviceOwnerLabel")}</span>
              <input
                value={deviceUser}
                onChange={(e) => setDeviceUser(e.target.value)}
                disabled={busy}
                placeholder={t("collector.deviceOwnerPlaceholder")}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setSource(randomCaseSource())}
            >
              {t("collector.newRandomLabel")}
            </Button>
          </div>
        </section>

        <nav
          className="public-collect__platform-tabs"
          role="tablist"
          aria-label={t("collector.platformTabsLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={platform === "android"}
            className={`public-collect__platform-tab${
              platform === "android" ? " public-collect__platform-tab--active" : ""
            }`}
            disabled={busy}
            onClick={() => setPlatform("android")}
          >
            <AndroidIcon size={16} />
            {t("collector.platformTabAndroid")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === "ios"}
            className={`public-collect__platform-tab${
              platform === "ios" ? " public-collect__platform-tab--active" : ""
            }`}
            disabled={busy || !iosUploadEnabled}
            title={!iosUploadEnabled ? t("collector.iosDisabledOnCollect") : undefined}
            onClick={() => setPlatform("ios")}
          >
            <AppleIcon size={16} />
            {t("collector.platformTabIos")}
          </button>
        </nav>

        {platform === "android" ? (
          <>
            <section className="card public-collect__panel public-collect__panel--android">
              <h2 className="public-collect__section-title">
                <Usb size={18} aria-hidden />
                {t("collector.androidWebUsbTitle")}
              </h2>
              <p className="muted text-sm">{t("collector.webUsbHint")}</p>
              <ol className="public-collect__steps muted text-sm">
                <li>{t("collector.stepUsbDebug")}</li>
                <li>{t("collector.stepAllow")}</li>
                <li>{t("collector.stepCollect")}</li>
              </ol>

              <div className="public-collect__magpie">
                <label className="public-collect__magpie-toggle">
                  <input
                    type="checkbox"
                    checked={magpieEnabled}
                    disabled={busy || magpieReady === false}
                    onChange={(e) => setMagpieEnabled(e.target.checked)}
                  />
                  <span>{t("collector.magpieToggle")}</span>
                </label>
                {magpieReady === false && (
                  <p className="muted text-xs public-collect__warn">{t("collector.magpieMissing")}</p>
                )}
                {magpieEnabled && magpieReady === true && (
                  <div className="public-collect__magpie-options">
                    <fieldset className="public-collect__magpie-commands" disabled={busy}>
                      <legend className="text-xs muted">{t("collector.commandsLabel")}</legend>
                      {(["find", "ps", "yara"] as MagpieCommand[]).map((cmd) => (
                        <label key={cmd} className="public-collect__magpie-toggle">
                          <input
                            type="checkbox"
                            checked={magpieCommands.includes(cmd)}
                            disabled={busy || (cmd === "yara" && !magpieYaraRulesB64)}
                            onChange={(e) =>
                              setSessionCommands((cmds) =>
                                toggleMagpieCommand(cmds, cmd, e.target.checked)
                              )
                            }
                          />
                          <span>{COMMAND_LABELS[cmd]}</span>
                        </label>
                      ))}
                    </fieldset>

                    {magpieCommands.includes("find") && (
                      <>
                        <div className="public-collect__magpie-paths">
                          <div className="public-collect__magpie-paths-head">
                            <span className="text-xs muted">{t("androidCollect.findPathsLabel")}</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm public-collect__magpie-add"
                              disabled={busy}
                              onClick={() => setSessionFindPaths((paths) => [...paths, ""])}
                            >
                              <Plus size={14} aria-hidden />
                              {t("androidCollect.addPath")}
                            </button>
                          </div>
                          <CollectPathList
                            paths={sessionFindPaths}
                            onChange={setSessionFindPaths}
                            disabled={busy}
                            placeholder="/sdcard"
                          />
                        </div>
                        <label className="public-collect__field">
                          <span className="text-xs muted">{t("androidCollect.maxDepthLabel")}</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            disabled={busy}
                            value={sessionMaxDepth}
                            onChange={(e) =>
                              setSessionMaxDepth(
                                Math.min(10, Math.max(1, Number(e.target.value) || 3))
                              )
                            }
                          />
                        </label>
                      </>
                    )}

                    {magpieCommands.includes("yara") && (
                      <>
                        <div className="public-collect__magpie-paths">
                          <div className="public-collect__magpie-paths-head">
                            <span className="text-xs muted">{t("androidCollect.yaraPathsLabel")}</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm public-collect__magpie-add"
                              disabled={busy}
                              onClick={() => setSessionYaraPaths((paths) => [...paths, ""])}
                            >
                              <Plus size={14} aria-hidden />
                              {t("androidCollect.addPath")}
                            </button>
                          </div>
                          <CollectPathList
                            paths={sessionYaraPaths}
                            onChange={setSessionYaraPaths}
                            disabled={busy}
                            placeholder="/sdcard"
                          />
                        </div>
                        <label className="public-collect__field">
                          <span className="text-xs muted">{t("androidCollect.yaraMaxDepthLabel")}</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            disabled={busy}
                            value={sessionYaraMaxDepth}
                            onChange={(e) =>
                              setSessionYaraMaxDepth(
                                Math.min(10, Math.max(1, Number(e.target.value) || 3))
                              )
                            }
                          />
                        </label>
                        <div className="public-collect__yara-rules">
                          <p className="text-xs muted">{t("collector.yaraRulesLabel")}</p>
                          {!magpieYaraRulesB64 || magpieYaraRuleNames.length === 0 ? (
                            <p className="muted text-xs public-collect__warn">
                              {t("collector.noYaraRules")}{" "}
                              {yaraHint(t("collector.openYaraTab"))}
                            </p>
                          ) : (
                            <ul className="public-collect__yara-rule-chips">
                              {magpieYaraRuleNames.map((name) => (
                                <li key={name} className="public-collect__yara-rule-chip">
                                  {name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}

                    {embedded && onOpenSettings && (
                      <p className="muted text-xs">
                        {t("collector.defaultsInSettings")}{" "}
                        {settingsHint(t("collector.openSettingsTab"))}
                        {" · "}
                        {t("collector.yaraRulesLabel")}: {yaraHint(t("collector.openYaraTab"))}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="public-collect__actions">
                <Button
                  type="button"
                  disabled={busy || !webUsbSupported() || webadbReady === false}
                  onClick={() => void collectViaWebUsb()}
                >
                  {busy
                    ? t("collector.working")
                    : magpieEnabled
                      ? t("collector.collectBugreportMagpie")
                      : t("collector.collectBugreport")}
                </Button>
                {magpieReady === true && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || !webUsbSupported() || webadbReady === false}
                    onClick={() => void collectMagpieOnlyViaWebUsb()}
                  >
                    {busy ? t("collector.working") : t("collector.magpieOnly")}
                  </Button>
                )}
              </div>
              {!webUsbSupported() && (
                <p className="error text-xs public-collect__warn">{t("collector.webUsbUnavailable")}</p>
              )}
              {webUsbSupported() && webadbReady === false && (
                <p className="muted text-xs public-collect__warn">{t("collector.webadbMissing")}</p>
              )}

              <div className="public-collect__repo-pull">
                <h3 className="public-collect__subsection-title">
                  <FolderDown size={16} aria-hidden />
                  {t("collector.pullTitle")}
                </h3>
                <p className="muted text-xs">{t("collector.pullSubtitle")}</p>
                <div className="public-collect__magpie-paths">
                  <div className="public-collect__magpie-paths-head">
                    <span className="text-xs muted">{t("androidCollect.pullReposLabel")}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm public-collect__magpie-add"
                      disabled={busy}
                      onClick={() => setSessionPullPaths((paths) => [...paths, ""])}
                    >
                      <Plus size={14} aria-hidden />
                      {t("androidCollect.addPath")}
                    </button>
                  </div>
                  <CollectPathList
                    paths={sessionPullPaths}
                    onChange={setSessionPullPaths}
                    disabled={busy}
                    allowEmpty
                    placeholder="/data/app"
                  />
                </div>
                <p className="muted text-xs">
                  {t("collector.pullLimitsHint", {
                    depth: String(pullMaxDepth),
                    maxMb: String(Math.round(pullMaxFileSize / (1024 * 1024))),
                    maxFiles: String(pullMaxFiles),
                  })}
                  {embedded && onOpenSettings && (
                    <>
                      {" "}
                      {t("collector.pullLimitsInSettings")} {settingsHint(t("collector.openSettingsTab"))}
                    </>
                  )}
                </p>
                <div className="public-collect__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      busy || !webUsbSupported() || webadbReady === false || activePullPaths.length === 0
                    }
                    onClick={() => void collectRepositoriesViaWebUsb()}
                  >
                    {busy ? t("collector.working") : t("collector.pullStart")}
                  </Button>
                </div>
                {pullSummary && <p className="text-sm settings-msg">{pullSummary}</p>}
                <p className="muted text-xs">
                  {t("collector.pullBlobHint")}{" "}
                  {embedded ? (
                    <Link to="/data">{t("data.blobStorageTitle")}</Link>
                  ) : (
                    t("data.blobStorageTitle")
                  )}
                </p>
              </div>
            </section>

            <section className="card public-collect__panel public-collect__panel--upload public-collect__panel--android-upload">
              <h2 className="public-collect__section-title">
                <Upload size={18} aria-hidden />
                {t("collector.uploadTitleAndroid")}
              </h2>
              <p className="muted text-sm">{t("collector.uploadHintAndroid")}</p>
              <div className="public-collect__uploads">
                <label className="public-collect__file-btn">
                  <Smartphone size={16} aria-hidden />
                  {t("collector.uploadAndroid")}
                  <input
                    type="file"
                    accept=".zip,.txt,application/zip"
                    disabled={busy}
                    hidden
                    onChange={(e) => void onFileUpload("android", e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </section>
          </>
        ) : (
          <section className="card public-collect__panel public-collect__panel--ios">
            <div className="public-collect__sysdiagnose-options">
              <div className="public-collect__sysdiagnose-options-head">
                <h2 className="public-collect__section-title">
                  {t("ingest.sysdiagnoseOptionsTitle")}
                </h2>
                <p className="muted text-xs">{t("ingest.sysdiagnoseOptionsLead")}</p>
              </div>
              <SysdiagnoseIngestOptionsFields
                config={sysdiagnoseOpts}
                onChange={setSysdiagnoseOpts}
                disabled={busy}
                label={(key) =>
                  t(`sysdiagnoseIngest.${key}` as "sysdiagnoseIngest.logarchiveUncappedLabel")
                }
              />
            </div>
            <IosWebUsbCollectSection
              disabled={busy}
              onLog={appendLog}
              instructions={iosInstructions}
              onUpload={async (data, label) => {
                await pushToSiem("ios", data, label);
              }}
            />
          </section>
        )}

        <section className="card public-collect__panel public-collect__logs-panel">
          <h2 className="public-collect__section-title">{t("collector.activityLog")}</h2>
          <div className="public-collect__logs" role="log" aria-live="polite">
            {logs.length === 0 ? (
              <p className="muted text-sm">{t("collector.activityEmpty")}</p>
            ) : (
              logs.map((line) => (
                <div key={line.id} className="public-collect__log-line">
                  <time className="mono muted">{line.time}</time>
                  <span>{line.text}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </section>
      </main>

      {error && <p className="error public-collect__error">{error}</p>}

      {result && (
        <footer className="card public-collect__result">
          <p>
            <strong>{result.ingested.toLocaleString()}</strong> {t("collector.eventsIngested")}
            {result.deduplicated ? ` ${t("collector.deduplicated")}` : ""}{" "}
            {t("collector.intoCase")} <strong>{result.case_title}</strong> (
            <code className="mono">{result.source}</code>).
          </p>
          {embedded ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/cases/${result.case_id}`}>{t("collector.openCase")}</Link>
            </Button>
          ) : (
            <>
              <p className="muted text-sm">{t("collector.signInHint")}</p>
              <Button variant="secondary" size="sm" asChild>
                <Link to={`/cases/${result.case_id}`}>{t("collector.openCaseLogin")}</Link>
              </Button>
            </>
          )}
        </footer>
      )}
    </>
  );

  if (embedded) {
    return <div className="public-collect public-collect--embedded">{panelBody}</div>;
  }
  return panelBody;
}
