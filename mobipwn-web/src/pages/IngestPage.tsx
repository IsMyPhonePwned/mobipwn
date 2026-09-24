import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  FileArchive,
  Search,
  Server,
  Smartphone,
  TabletSmartphone,
  Upload,
  XCircle,
} from "lucide-react";
import { EndpointDeviceRuleFields } from "@/components/ironsift/EndpointDeviceRuleFields";
import { TagScopeChips } from "@/components/ironsift/TagScopeChips";
import { IngestProgressPanel } from "@/components/ingest/IngestProgressPanel";
import { SysdiagnoseIngestOptionsFields } from "@/components/ingest/SysdiagnoseIngestOptionsFields";
import {
  DEFAULT_SYSDIAGNOSE_INGEST_CONFIG,
  type SysdiagnoseIngestConfig,
} from "@/components/settings/SettingsSysdiagnoseIngestSection";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useIronSiftPluginEnabled } from "@/contexts/PluginsContext";
import { apiFetch } from "@/lib/api";
import {
  pickUnusedCaseSource,
  randomCaseSource,
  rememberLastCaseSource,
} from "@/lib/caseSource";
import { DEMO_ENDPOINT_JSONL } from "@/lib/endpointDemoData";
import { parseCaseTagInput, resolveCaseIdForIngestSource } from "@/lib/cases";
import {
  endpointDeviceRuleQuery,
  uploadEndpointJsonl,
  uploadEndpointZip,
} from "@/lib/ingestEndpoint";
import {
  fetchIronSiftConfig,
  fetchIronSiftScopeOptions,
  mergeEndpointIngestConfig,
  type EndpointIngestConfig,
  type IronSiftScopeOptions,
} from "@/lib/ironsift";
import {
  endpointIngestSteps,
  formatBytes,
  mobileIngestSteps,
  type IngestProgress,
} from "@/lib/ingestProgress";
import { uploadIngestArchive } from "@/lib/ingestUpload";
import type { LucideIcon } from "lucide-react";

type DataSummary = { total_events: number; sources: { source: string }[] };
type IngestKind = "bugreport" | "sysdiagnose" | "endpoint";

type PlatformMeta = {
  accept?: string;
  asideKey: string;
  formatsKey: string;
  descKey: string;
  chips: string[];
  Icon: LucideIcon;
};

const PLATFORM_META: Record<IngestKind, PlatformMeta> = {
  bugreport: {
    asideKey: "ingest.asideAndroid",
    formatsKey: "ingest.formatsAndroid",
    descKey: "ingest.platformDescAndroid",
    chips: [".txt", ".zip"],
    Icon: Smartphone,
  },
  sysdiagnose: {
    accept: ".tar.gz,.tgz,.tar.xz,.xz,application/gzip,application/x-xz",
    asideKey: "ingest.asideIos",
    formatsKey: "ingest.formatsIos",
    descKey: "ingest.platformDescIos",
    chips: [".tar.gz", ".tar.xz"],
    Icon: TabletSmartphone,
  },
  endpoint: {
    accept: ".csv,.json,.jsonl,.txt,.zip",
    asideKey: "ingest.asideEndpoint",
    formatsKey: "ingest.formatsEndpoint",
    descKey: "ingest.platformDescEndpoint",
    chips: [".jsonl", ".json", ".csv", ".zip"],
    Icon: Server,
  },
};

export default function IngestPage() {
  const { t } = useLocale();
  const { enabled: ironSiftEnabled, loaded: pluginsLoaded } = useIronSiftPluginEnabled();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [sourceReady, setSourceReady] = useState(false);
  const [caseUser, setCaseUser] = useState("");
  const [tags, setTags] = useState("");
  const [platform, setPlatform] = useState<IngestKind>("bugreport");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [ingestedCaseId, setIngestedCaseId] = useState<string | null>(null);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [cliCopied, setCliCopied] = useState(false);
  const [scopeOptions, setScopeOptions] = useState<IronSiftScopeOptions | null>(null);
  const [endpointIngest, setEndpointIngest] = useState<EndpointIngestConfig>(() =>
    mergeEndpointIngestConfig()
  );
  const [sysdiagnoseOpts, setSysdiagnoseOpts] = useState<SysdiagnoseIngestConfig>(
    DEFAULT_SYSDIAGNOSE_INGEST_CONFIG
  );
  const [anonEnabled, setAnonEnabled] = useState(false);
  const [anonProfile, setAnonProfile] = useState<"balanced" | "strict" | "research">("balanced");
  const [anonLogarchive, setAnonLogarchive] = useState<"drop" | "jsonl">("drop");
  const [anonOrdinal, setAnonOrdinal] = useState(false);
  const [anonKeepLocation, setAnonKeepLocation] = useState(false);
  const [anonKeepCellIds, setAnonKeepCellIds] = useState(false);
  const [anonGeneralizeCarrier, setAnonGeneralizeCarrier] = useState(false);
  const [anonDropCarrier, setAnonDropCarrier] = useState(false);
  const [anonPseudoPackages, setAnonPseudoPackages] = useState(false);
  const [anonTimeShift, setAnonTimeShift] = useState("");
  const [anonOnly, setAnonOnly] = useState("");
  const [anonEntities, setAnonEntities] = useState("");
  const [anonDropTextPkgs, setAnonDropTextPkgs] = useState("");
  const { log } = useActivityLog();

  const isEndpoint = platform === "endpoint";
  const isSysdiagnose = platform === "sysdiagnose";
  const knownTags = scopeOptions?.tags ?? [];
  const meta = PLATFORM_META[platform];
  const PlatformIcon = meta.Icon;
  const hasSource = Boolean(source.trim());
  const canUpload = hasSource && Boolean(file) && !loading;

  useEffect(() => {
    apiFetch<DataSummary>("/v1/data/summary")
      .then((summary) => {
        const used = summary.sources.map((s) => s.source);
        setSource(pickUnusedCaseSource(used));
        setSourceCount(summary.sources.length);
        setEventCount(summary.total_events);
      })
      .catch(() => {
        setSource(randomCaseSource());
        setSourceCount(null);
        setEventCount(null);
      })
      .finally(() => setSourceReady(true));
  }, []);

  useEffect(() => {
    if (!pluginsLoaded) return;
    if (!ironSiftEnabled && platform === "endpoint") {
      setPlatform("bugreport");
      setFile(null);
      setStatus("");
      setIngestedCaseId(null);
      setProgress(null);
    }
  }, [pluginsLoaded, ironSiftEnabled, platform]);

  useEffect(() => {
    if (!isEndpoint) return;
    void fetchIronSiftConfig()
      .then((cfg) => setEndpointIngest(mergeEndpointIngestConfig(cfg.endpoint_ingest)))
      .catch(() => {});
    void fetchIronSiftScopeOptions()
      .then(setScopeOptions)
      .catch(() => setScopeOptions(null));
  }, [isEndpoint]);

  useEffect(() => {
    if (!isSysdiagnose) return;
    void fetch("/api/v1/settings/sysdiagnose_ingest")
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as Partial<SysdiagnoseIngestConfig>;
        setSysdiagnoseOpts({
          logarchive_decode_max_lines:
            typeof body.logarchive_decode_max_lines === "number"
              ? body.logarchive_decode_max_lines
              : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.logarchive_decode_max_lines,
          ioservice_full_tree: Boolean(body.ioservice_full_tree),
          logarchive_uncapped: Boolean(body.logarchive_uncapped),
          max_entry_mb:
            typeof body.max_entry_mb === "number"
              ? body.max_entry_mb
              : DEFAULT_SYSDIAGNOSE_INGEST_CONFIG.max_entry_mb,
        });
      })
      .catch(() => {});
  }, [isSysdiagnose]);

  const suggestSource = () => {
    log("info", "Generate new ingest source label");
    apiFetch<DataSummary>("/v1/data/summary")
      .then((summary) => {
        setSource(pickUnusedCaseSource(summary.sources.map((s) => s.source)));
        setSourceCount(summary.sources.length);
        setEventCount(summary.total_events);
      })
      .catch(() => setSource(randomCaseSource()));
  };

  const phaseLabel = useMemo(() => {
    if (!progress) return "";
    switch (progress.phase) {
      case "hash":
        return t("ingest.computingHash");
      case "upload":
        return t("ingest.uploading");
      case "read":
        return t("ingest.readingFile");
      case "post":
        return t("ingest.sendingToApi");
      case "processing":
        switch (progress.stage) {
          case "queued":
            return t("ingest.stageQueued");
          case "anonymizing":
            return t("ingest.stageAnonymizing");
          case "opening":
            return t("ingest.stageOpening");
          case "parsing":
            return t("ingest.stageParsing");
          case "logarchive":
            return t("ingest.stageLogarchive");
          case "parsed":
            return t("ingest.stageParsed");
          case "inserting":
            return t("ingest.stageInserting");
          case "verifying":
            return t("ingest.stageVerifying");
          case "syncing":
            return t("ingest.stageSyncing");
          default:
            return t("ingest.processing");
        }
      default:
        return t("ingest.working");
    }
  }, [progress, t]);

  const progressSteps = useMemo(() => {
    if (!progress) return [];
    if (isEndpoint) {
      return endpointIngestSteps(progress.phase, {
        read: t("ingest.stepRead"),
        post: t("ingest.stepPost"),
        indexed: t("ingest.stepIndexed"),
      });
    }
    return mobileIngestSteps(progress.phase, {
      hash: t("ingest.stepHash"),
      upload: t("ingest.stepUpload"),
      processing: t("ingest.stepProcessing"),
    });
  }, [progress, isEndpoint, t]);

  function pickPlatform(next: IngestKind) {
    if (next === "endpoint" && !ironSiftEnabled) return;
    setPlatform(next);
    setFile(null);
    setStatus("");
    setProgress(null);
    setStatusOk(false);
  }

  function pickFile(next: File | null) {
    setFile(next);
    setStatus("");
    setStatusOk(false);
    setIngestedCaseId(null);
  }

  async function linkIngestedCase(sourceLabel: string) {
    setIngestedCaseId(null);
    try {
      const caseId = await resolveCaseIdForIngestSource(sourceLabel);
      setIngestedCaseId(caseId);
    } catch {
      setIngestedCaseId(null);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  }

  const upload = async (useDemo = false) => {
    if (!source.trim()) return;
    setLoading(true);
    setStatus("");
    setStatusOk(false);
    setIngestedCaseId(null);
    setProgress(null);
    try {
      const uploadTags = parseCaseTagInput(tags);
      if (isEndpoint) {
        setProgress({
          percent: 2,
          phase: "read",
          detail: useDemo ? t("ingest.demoFleetDetail") : undefined,
        });
        let jsonl: string;
        if (useDemo) {
          jsonl = DEMO_ENDPOINT_JSONL;
        } else if (file) {
          if (file.name.toLowerCase().endsWith(".zip")) {
            const result = await uploadEndpointZip({
              source: source.trim(),
              file,
              user: caseUser.trim() || undefined,
              tags: uploadTags,
              deviceRule: endpointDeviceRuleQuery(endpointIngest),
              onProgress: setProgress,
            });
            setStatus(t("ingest.ingestedEvents", { count: result.ingested }));
            setStatusOk(true);
            rememberLastCaseSource(source);
            void linkIngestedCase(source.trim());
            return;
          }
          setProgress({
            percent: 5,
            phase: "read",
            detail: `${file.name} · ${formatBytes(file.size)}`,
          });
          jsonl = await file.text();
        } else {
          return;
        }
        const result = await uploadEndpointJsonl({
          source: source.trim(),
          jsonl,
          fileName: useDemo ? "demo-fleet.jsonl" : file?.name,
          tags: uploadTags,
          onProgress: setProgress,
        });
        setStatus(t("ingest.ingestedEvents", { count: result.ingested }));
        setStatusOk(true);
        rememberLastCaseSource(source);
        void linkIngestedCase(source.trim());
        return;
      }

      if (!file) return;
      const result = await uploadIngestArchive({
        source: source.trim(),
        platform: platform === "bugreport" ? "android" : "ios",
        user: caseUser.trim() || undefined,
        tags: uploadTags,
        file,
        sysdiagnose:
          platform === "sysdiagnose"
            ? {
                logarchive_uncapped: sysdiagnoseOpts.logarchive_uncapped,
                logarchive_decode_max_lines: sysdiagnoseOpts.logarchive_decode_max_lines,
                max_entry_mb: sysdiagnoseOpts.max_entry_mb,
                ioservice_full_tree: sysdiagnoseOpts.ioservice_full_tree,
              }
            : undefined,
        anonymize: anonEnabled
          ? {
              enabled: true,
              profile: anonProfile,
              logarchive: anonLogarchive,
              ordinal: anonOrdinal,
              keep_location: anonKeepLocation,
              keep_cell_ids: anonKeepCellIds,
              generalize_carrier: anonGeneralizeCarrier,
              drop_carrier: anonDropCarrier,
              pseudo_third_party_packages: anonPseudoPackages,
              ...(anonTimeShift.trim() ? { time_shift: anonTimeShift.trim() } : {}),
              ...(anonOnly.trim() ? { only: anonOnly.trim() } : {}),
              ...(anonEntities.trim()
                ? {
                    entities: anonEntities
                      .split(/[\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(anonDropTextPkgs.trim()
                ? {
                    drop_text_from_packages: anonDropTextPkgs
                      .split(/[\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                : {}),
            }
          : undefined,
        onProgress: setProgress,
      });
      const msg = result.deduplicated
        ? t("ingest.alreadyIngested", { count: result.ingested })
        : t("ingest.ingestedEvents", { count: result.ingested });
      setStatus(msg);
      setStatusOk(true);
      rememberLastCaseSource(source);
      void linkIngestedCase(source.trim());
    } catch (e) {
      setStatus(String(e));
      setStatusOk(false);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const cliSnippet = isEndpoint
    ? t("ingest.endpointCli").replace("SOURCE", source || "case-endpoint-001")
    : `cargo run -p mobipwn-ingest -- ${platform} -i /path/to/archive -s ${source || "case-001"}`;

  async function copyCli() {
    try {
      await navigator.clipboard.writeText(cliSnippet);
      setCliCopied(true);
      window.setTimeout(() => setCliCopied(false), 2000);
    } catch {
      log("warn", "Copy CLI failed");
    }
  }

  const platformOptions = useMemo(() => {
    const base: Array<[IngestKind, string, PlatformMeta]> = [
      ["bugreport", t("ingest.androidBugreport"), PLATFORM_META.bugreport],
      ["sysdiagnose", t("ingest.iosSysdiagnose"), PLATFORM_META.sysdiagnose],
    ];
    if (ironSiftEnabled) {
      base.push(["endpoint", t("ingest.endpointJsonl"), PLATFORM_META.endpoint]);
    }
    return base;
  }, [ironSiftEnabled, t]);

  const activeStep = !hasSource ? 1 : !file && !loading ? 2 : 3;
  const caseHref = ingestedCaseId
    ? `/cases/${ingestedCaseId}`
    : `/cases/search?q=${encodeURIComponent(source)}`;

  return (
    <div className={`ingest-page ingest-page--${platform}`}>
      <header className="card mpl-guide-hero ingest-hero">
        <div className="mpl-guide-hero__top">
          <div>
            <p className="mpl-guide-hero__eyebrow">{t("ingest.eyebrow")}</p>
            <h1>
              <Upload className="icon inline-icon" aria-hidden />
              {t("ingest.title")}
            </h1>
            <p className="mpl-guide-hero__subtitle">{t("ingest.subtitle")}</p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/data">
              <Database className="icon" />
              {t("nav.data")}
            </Link>
          </Button>
        </div>

        {sourceCount !== null && (
          <div className="ingest-hero__stats">
            <span className="ingest-hero__stat">
              <strong>{sourceCount}</strong>
              <span className="muted">{t("ingest.statCases")}</span>
            </span>
            {eventCount !== null && (
              <span className="ingest-hero__stat">
                <strong>{eventCount.toLocaleString()}</strong>
                <span className="muted">{t("ingest.statEvents")}</span>
              </span>
            )}
          </div>
        )}

        <div className="mpl-guide-hero__chips">
          <span className="mpl-guide-chip">{t("ingest.chipMudm")}</span>
          <span className="mpl-guide-chip">{t("ingest.chipClickhouse")}</span>
          {isEndpoint && <span className="mpl-guide-chip">{t("ingest.chipIronSift")}</span>}
        </div>
      </header>

      <ol className="ingest-steps" aria-label={t("ingest.stepsLabel")}>
        {(
          [
            [1, t("ingest.stepType")],
            [2, t("ingest.stepCase")],
            [3, t("ingest.stepFile")],
          ] as const
        ).map(([n, label]) => (
          <li
            key={n}
            className={`ingest-steps__item${activeStep === n ? " ingest-steps__item--active" : ""}${activeStep > n ? " ingest-steps__item--done" : ""}`}
          >
            <span className="ingest-steps__num" aria-hidden>
              {activeStep > n ? <Check className="icon" /> : n}
            </span>
            <span className="ingest-steps__label">{label}</span>
          </li>
        ))}
      </ol>

      <section className="card ingest-card">
            <div className="ingest-card__section">
              <div className="ingest-section-head">
                <h2 className="ingest-section-title">{t("ingest.platformTitle")}</h2>
                <p className="muted text-xs ingest-section-lead">{t(meta.descKey)}</p>
              </div>
              <div
                className="ingest-platform-picker"
                role="radiogroup"
                aria-label={t("ingest.platformTitle")}
              >
                {platformOptions.map(([id, label, pm]) => {
                  const Icon = pm.Icon;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={platform === id}
                      className={`ingest-platform-option ingest-platform-option--${id}${platform === id ? " ingest-platform-option--active" : ""}`}
                      onClick={() => pickPlatform(id)}
                    >
                      <span className="ingest-platform-option__icon-wrap" aria-hidden>
                        <Icon className="icon ingest-platform-option__icon" />
                      </span>
                      <span className="ingest-platform-option__label">{label}</span>
                      <span className="ingest-platform-option__chips">
                        {pm.chips.map((ext) => (
                          <span key={ext} className="ingest-platform-option__chip">
                            {ext}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              {pluginsLoaded && !ironSiftEnabled ? (
                <p className="muted text-xs ingest-ironsift-disabled">
                  {t("ingest.endpointPluginDisabled")}{" "}
                  <Link to="/settings?section=plugins">{t("plugins.openSettings")}</Link>
                </p>
              ) : null}
            </div>

            <div className="ingest-card__section">
              <h2 className="ingest-section-title">{t("ingest.caseSection")}</h2>
              <div className="ingest-form-grid">
                <label className="ingest-field ingest-field--wide">
                  <span className="ingest-field__label">{t("ingest.sourceLabel")}</span>
                  <div className="ingest-source-row">
                    <input
                      className="mono"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder={sourceReady ? undefined : t("ingest.generating")}
                    />
                    <Button type="button" variant="secondary" onClick={suggestSource}>
                      {t("ingest.newLabel")}
                    </Button>
                  </div>
                  <span className="ingest-field__hint">{t("ingest.sourceHint")}</span>
                </label>

                {!isEndpoint && (
                  <label className="ingest-field">
                    <span className="ingest-field__label">{t("ingest.deviceOwner")}</span>
                    <input
                      value={caseUser}
                      onChange={(e) => setCaseUser(e.target.value)}
                      placeholder={t("ingest.ownerPlaceholder")}
                    />
                  </label>
                )}

                <label className="ingest-field ingest-field--wide">
                  <span className="ingest-field__label">{t("ingest.tagsLabel")}</span>
                  <input
                    className="mono"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder={t("cases.tagsPlaceholder")}
                  />
                  <span className="ingest-field__hint">{t("cases.tagsHint")}</span>
                  {isEndpoint && knownTags.length > 0 && (
                    <TagScopeChips knownTags={knownTags} selectedTags={tags} onChange={setTags} />
                  )}
                </label>
              </div>
            </div>

            {isSysdiagnose && (
              <div className="ingest-card__section">
                <div className="ingest-section-head">
                  <h2 className="ingest-section-title">{t("ingest.sysdiagnoseOptionsTitle")}</h2>
                  <p className="muted text-xs ingest-section-lead">
                    {t("ingest.sysdiagnoseOptionsLead")}
                  </p>
                </div>
                <div className="ingest-sysdiagnose-options">
                  <SysdiagnoseIngestOptionsFields
                    config={sysdiagnoseOpts}
                    onChange={setSysdiagnoseOpts}
                    disabled={loading}
                    label={(key) =>
                      t(`sysdiagnoseIngest.${key}` as "sysdiagnoseIngest.logarchiveUncappedLabel")
                    }
                  />
                </div>
              </div>
            )}

            <div className="ingest-card__section">
              <div className="ingest-section-head">
                <h2 className="ingest-section-title">{t("ingest.fileSection")}</h2>
                <p className="muted text-xs ingest-section-lead">{t(meta.formatsKey)}</p>
              </div>

              <div
                className={`ingest-file-drop${dragOver ? " ingest-file-drop--over" : ""}${file ? " ingest-file-drop--has-file" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
                role="button"
                tabIndex={0}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="ingest-file-drop__input"
                  accept={meta.accept}
                  onChange={onFileInput}
                />
                {file ? (
                  <div className="ingest-file-drop__selected">
                    <FileArchive className="icon ingest-file-drop__file-icon" aria-hidden />
                    <div className="ingest-file-drop__file-meta">
                      <span className="ingest-file-drop__name mono">{file.name}</span>
                      <span className="muted text-xs">{formatBytes(file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="ingest-file-drop__clear"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      {t("ingest.clearFile")}
                    </button>
                  </div>
                ) : (
                  <div className="ingest-file-drop__empty">
                    <span className="ingest-file-drop__upload-icon" aria-hidden>
                      <Upload className="icon" />
                    </span>
                    <span className="ingest-file-drop__prompt">{t("ingest.fileDropLabel")}</span>
                    <span className="muted text-xs">{t("ingest.fileDropHint")}</span>
                    <span className="ingest-file-drop__browse">{t("ingest.browseFile")}</span>
                  </div>
                )}
              </div>

              {isEndpoint && (
                <details
                  className="ironsift-ingest-device-rule ingest-device-rule"
                  open={Boolean(endpointIngest.zip_device_rule?.parent_dir_field)}
                >
                  <summary>{t("ironsift.ingestDeviceRuleTitle")}</summary>
                  <EndpointDeviceRuleFields
                    value={endpointIngest}
                    canEdit
                    onChange={setEndpointIngest}
                  />
                </details>
              )}
            </div>

            <div className="ingest-ready">
              <span className="ingest-ready__title">{t("ingest.readyTitle")}</span>
              <ul className="ingest-ready__list">
                <li className={`ingest-ready__item${hasSource ? " ingest-ready__item--ok" : ""}`}>
                  <span className="ingest-ready__dot" aria-hidden />
                  {t("ingest.readySource")}
                </li>
                <li className={`ingest-ready__item${file ? " ingest-ready__item--ok" : ""}`}>
                  <span className="ingest-ready__dot" aria-hidden />
                  {t("ingest.readyFile")}
                </li>
              </ul>
            </div>

            {!isEndpoint && (
              <div className="ingest-anonymize">
                <label className="ingest-anonymize__check">
                  <input
                    type="checkbox"
                    checked={anonEnabled}
                    disabled={loading}
                    onChange={(e) => setAnonEnabled(e.target.checked)}
                  />
                  <span>{t("ingest.anonymizeEnable")}</span>
                </label>
                <p className="muted text-xs">{t("ingest.anonymizeLead")}</p>
                {anonEnabled && (
                  <div className="ingest-anonymize__opts">
                    <label className="ingest-anonymize__label">
                      <span>{t("ingest.anonymizeProfile")}</span>
                      <select
                        value={anonProfile}
                        onChange={(e) =>
                          setAnonProfile(e.target.value as "balanced" | "strict" | "research")
                        }
                        disabled={loading}
                      >
                        <option value="balanced">{t("ingest.anonymizeProfileBalanced")}</option>
                        <option value="strict">{t("ingest.anonymizeProfileStrict")}</option>
                        <option value="research">{t("ingest.anonymizeProfileResearch")}</option>
                      </select>
                    </label>
                    <label className="ingest-anonymize__label">
                      <span>{t("ingest.anonymizeLogarchive")}</span>
                      <select
                        value={anonLogarchive}
                        onChange={(e) => setAnonLogarchive(e.target.value as "drop" | "jsonl")}
                        disabled={loading}
                      >
                        <option value="drop">{t("ingest.anonymizeLogarchiveDrop")}</option>
                        <option value="jsonl">{t("ingest.anonymizeLogarchiveJsonl")}</option>
                      </select>
                    </label>
                    <label className="ingest-anonymize__label">
                      <span>{t("ingest.anonymizeTimeShift")}</span>
                      <input
                        type="text"
                        value={anonTimeShift}
                        onChange={(e) => setAnonTimeShift(e.target.value)}
                        placeholder="72h"
                        disabled={loading}
                      />
                    </label>
                    <label className="ingest-anonymize__label">
                      <span>{t("ingest.anonymizeOnly")}</span>
                      <input
                        type="text"
                        value={anonOnly}
                        onChange={(e) => setAnonOnly(e.target.value)}
                        placeholder="email,imei,ssid"
                        disabled={loading}
                      />
                    </label>
                    <label className="ingest-anonymize__label ingest-anonymize__label--wide">
                      <span>{t("ingest.anonymizeEntities")}</span>
                      <input
                        type="text"
                        value={anonEntities}
                        onChange={(e) => setAnonEntities(e.target.value)}
                        placeholder="gps=keep,imei=drop"
                        disabled={loading}
                      />
                    </label>
                    <label className="ingest-anonymize__label ingest-anonymize__label--wide">
                      <span>{t("ingest.anonymizeDropTextPkgs")}</span>
                      <input
                        type="text"
                        value={anonDropTextPkgs}
                        onChange={(e) => setAnonDropTextPkgs(e.target.value)}
                        placeholder="com.example.app"
                        disabled={loading}
                      />
                    </label>
                    <div className="ingest-anonymize__flags">
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonOrdinal}
                          disabled={loading}
                          onChange={(e) => setAnonOrdinal(e.target.checked)}
                        />
                        {t("ingest.anonymizeOrdinal")}
                      </label>
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonKeepLocation}
                          disabled={loading}
                          onChange={(e) => setAnonKeepLocation(e.target.checked)}
                        />
                        {t("ingest.anonymizeKeepLocation")}
                      </label>
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonKeepCellIds}
                          disabled={loading}
                          onChange={(e) => setAnonKeepCellIds(e.target.checked)}
                        />
                        {t("ingest.anonymizeKeepCellIds")}
                      </label>
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonGeneralizeCarrier}
                          disabled={loading}
                          onChange={(e) => setAnonGeneralizeCarrier(e.target.checked)}
                        />
                        {t("ingest.anonymizeGeneralizeCarrier")}
                      </label>
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonDropCarrier}
                          disabled={loading}
                          onChange={(e) => setAnonDropCarrier(e.target.checked)}
                        />
                        {t("ingest.anonymizeDropCarrier")}
                      </label>
                      <label className="ingest-anonymize__flag">
                        <input
                          type="checkbox"
                          checked={anonPseudoPackages}
                          disabled={loading}
                          onChange={(e) => setAnonPseudoPackages(e.target.checked)}
                        />
                        {t("ingest.anonymizePseudoPackages")}
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="ingest-actions">
              <Button disabled={!canUpload} onClick={() => void upload(false)}>
                {loading ? (
                  phaseLabel || t("ingest.uploading")
                ) : (
                  <>
                    <Upload className="icon" />
                    {t("ingest.uploadIngest")}
                  </>
                )}
              </Button>
              {isEndpoint && (
                <Button variant="secondary" disabled={loading || !hasSource} onClick={() => void upload(true)}>
                  {t("ingest.endpointDemo")}
                </Button>
              )}
            </div>

            <IngestProgressPanel
              visible={loading && progress !== null}
              title={t("ingest.progressTitle")}
              percent={progress?.percent ?? 0}
              phaseLabel={phaseLabel}
              detail={progress?.detail}
              stage={progress?.stage}
              parsers={progress?.parsers}
              parsersCompleted={progress?.parsersCompleted}
              parsersTotal={progress?.parsersTotal}
              parsersActive={progress?.parsersActive}
              logarchive={progress?.logarchive}
              steps={progressSteps}
            />

            {status && (
              <div
                className={`ingest-result${statusOk ? " ingest-result--ok" : " ingest-result--error"}`}
                role="status"
              >
                <div className="ingest-result__head">
                  {statusOk ? (
                    <CheckCircle2 className="icon ingest-result__icon ingest-result__icon--ok" />
                  ) : (
                    <XCircle className="icon ingest-result__icon ingest-result__icon--error" />
                  )}
                  <p className="ingest-result__message">{status}</p>
                </div>
                {statusOk && (
                  <div className="ingest-result__links">
                    <span className="muted text-xs">{t("ingest.nextSteps")}</span>
                    <div className="ingest-result__link-row">
                      <Button variant="secondary" size="sm" asChild>
                        <Link to="/data">
                          <Database className="icon" />
                          {t("nav.data")}
                        </Link>
                      </Button>
                      <Button variant="secondary" size="sm" asChild>
                        <Link to={`/search?source=${encodeURIComponent(source)}`}>
                          <Search className="icon" />
                          {t("nav.search")}
                        </Link>
                      </Button>
                      <Button variant="secondary" size="sm" asChild>
                        <Link to={caseHref}>
                          <ArrowRight className="icon" />
                          {t("ingest.linkCase")}
                        </Link>
                      </Button>
                      {isEndpoint && (
                        <Button variant="secondary" size="sm" asChild>
                          <Link to="/ironsift">
                            <Server className="icon" />
                            {t("ingest.linkIronSift")}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <details className="ingest-format-panel">
              <summary className="ingest-format-panel__summary">
                <PlatformIcon className="icon ingest-format-panel__icon" aria-hidden />
                <span>{t("ingest.asideTitle")}</span>
                <span className="muted text-xs ingest-format-panel__formats">{t(meta.formatsKey)}</span>
              </summary>
              <div className="ingest-format-panel__body">
                <p className="muted text-xs ingest-format-panel__text">{t(meta.asideKey)}</p>
                {isEndpoint && (
                  <p className="muted text-xs ingest-format-panel__links">
                    <Link to="/ironsift">{t("ingest.linkIronSift")}</Link>
                    {" · "}
                    <Link to="/ironsift">{t("ingest.linkIronSiftConfig")}</Link>
                  </p>
                )}
                <details className="ingest-cli ingest-cli--nested">
                  <summary>{t("ingest.cliTitle")}</summary>
                  <div className="ingest-cli__block">
                    <pre className="mono muted ingest-cli__code">{cliSnippet}</pre>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void copyCli()}>
                      {cliCopied ? <Check className="icon" /> : <Copy className="icon" />}
                      {cliCopied ? t("ingest.copiedCli") : t("ingest.copyCli")}
                    </Button>
                  </div>
                </details>
              </div>
            </details>
          </section>
    </div>
  );
}
