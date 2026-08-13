import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Package, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppleIcon } from "@/components/icons/PlatformIcons";
import { useLocale } from "@/contexts/LocaleContext";
import {
  clearStoredPairPlist,
  diagnoseWebUsb,
  downloadSysdiagnoseArchive,
  formatIdeviceBytes,
  getStoredPairPlist,
  ideviceWasmAvailable,
  listSysdiagnoseArchives,
  pairIphoneDevice,
  pickIphoneDevice,
  storePairPlist,
  type SysdiagnoseArchiveEntry,
} from "@/lib/idevice";

type IosCollectTab = "device" | "upload";

type Props = {
  disabled?: boolean;
  onLog?: (text: string) => void;
  onUpload: (data: Blob, label: string) => Promise<void>;
  instructions?: string;
};

function statusState(ok: boolean, warn = false): "ok" | "warn" | "off" {
  if (ok) return "ok";
  if (warn) return "warn";
  return "off";
}

export function IosWebUsbCollectSection({
  disabled = false,
  onLog,
  onUpload,
  instructions = "",
}: Props) {
  const { t } = useLocale();
  const [tab, setTab] = useState<IosCollectTab>("device");
  const [wasmReady, setWasmReady] = useState<boolean | null>(null);
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [paired, setPaired] = useState(() => !!getStoredPairPlist());
  const [archives, setArchives] = useState<SysdiagnoseArchiveEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastAction, setLastAction] = useState("Idle");
  const [error, setError] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ideviceWasmAvailable()
      .then(setWasmReady)
      .catch(() => setWasmReady(false));
  }, []);

  const log = useCallback(
    (text: string) => {
      setLastAction(text);
      onLog?.(text);
    },
    [onLog]
  );

  const pickDevice = async () => {
    setError("");
    setBusy(true);
    try {
      const problem = diagnoseWebUsb();
      if (problem) throw new Error(problem);
      const dev = await pickIphoneDevice();
      setDevice(dev);
      log(
        `iPhone connected: ${dev.productName || "Apple device"}${
          dev.serialNumber ? ` · ${dev.serialNumber.slice(0, 8)}…` : ""
        }`
      );
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log(`iOS WebUSB: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const pairDevice = async () => {
    if (!device) return;
    setError("");
    setBusy(true);
    try {
      log("Pairing with device (Trust This Computer if prompted)…");
      await pairIphoneDevice(device, "random", false);
      setPaired(true);
      log("Pair record saved in this browser.");
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log(`Pair failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const loadPairFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    if (!text.includes("<plist")) {
      setError("Not a pair-record plist XML.");
      return;
    }
    storePairPlist(text);
    setPaired(true);
    log(`Loaded pair record from ${file.name}`);
  };

  const clearPair = () => {
    clearStoredPairPlist();
    setPaired(false);
    setArchives([]);
    setSelectedPath(null);
    log("Cleared stored pair record.");
  };

  const refreshList = async () => {
    if (!device) return;
    setError("");
    setBusy(true);
    setProgress("");
    try {
      log("Listing sysdiagnose archives on device…");
      const list = await listSysdiagnoseArchives(device);
      setArchives(list);
      setSelectedPath(list[0]?.path ?? null);
      log(list.length ? `Found ${list.length} archive(s).` : "No sysdiagnose archives found.");
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log(`List failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const collectSelected = async () => {
    if (!device || !selectedPath) return;
    const entry = archives.find((a) => a.path === selectedPath);
    setError("");
    setBusy(true);
    try {
      log(`Downloading ${entry?.name || selectedPath}…`);
      const result = await downloadSysdiagnoseArchive(device, selectedPath, {
        onProgress: (done, total) => {
          const pct = total > 0 ? Math.round((100 * done) / total) : 0;
          setProgress(
            `${formatIdeviceBytes(done)}${total > 0 ? ` / ${formatIdeviceBytes(total)} (${pct}%)` : ""}`
          );
        },
      });
      setProgress("");
      log(`Downloaded ${result.name} (${formatIdeviceBytes(result.byteLength)}) — uploading…`);
      const blob = new Blob([result.data], { type: "application/gzip" });
      await onUpload(blob, result.name);
      log(`Ingest queued for ${result.name}`);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log(`Download/upload failed: ${msg}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const submitUploadFile = async () => {
    if (!uploadFile || disabled || busy) return;
    setError("");
    setBusy(true);
    try {
      log(`Uploading ${uploadFile.name}…`);
      await onUpload(uploadFile, uploadFile.name);
      log(`Ingest queued for ${uploadFile.name}`);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log(`Upload failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptUploadFile = (file: File | null) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".tar.gz") && !name.endsWith(".tgz") && !name.endsWith(".gz")) {
      setError(t("collector.iosUploadBadType"));
      return;
    }
    setError("");
    setUploadFile(file);
  };

  const selected = archives.find((a) => a.path === selectedPath) ?? null;
  const deviceLabel = device?.productName || t("collector.iosDeviceNone");
  const pairLabel = paired ? t("collector.iosPairReady") : t("collector.iosPairNeeded");
  const jobLabel = progress || lastAction;
  const wasmMissing = wasmReady === false;

  const tabs = (
    <div className="public-collect-ios__tabs" role="tablist" aria-label={t("collector.iosTabsLabel")}>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "device"}
        className={`public-collect-ios__tab${tab === "device" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={() => setTab("device")}
      >
        {t("collector.iosTabDevice")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "upload"}
        className={`public-collect-ios__tab${tab === "upload" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={() => setTab("upload")}
      >
        {t("collector.iosTabUpload")}
      </button>
    </div>
  );

  const uploadPanel: ReactNode = (
    <div className="public-collect-ios__upload">
      <p className="muted text-sm">{t("collector.uploadHintIos")}</p>
      {instructions.trim() ? (
        <p className="muted text-xs public-collect__ios-hint">{instructions}</p>
      ) : null}
      <div
        className={`public-collect-ios__drop${dragOver ? " is-over" : ""}${
          uploadFile ? " has-file" : ""
        }`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          acceptUploadFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        {uploadFile ? (
          <div className="public-collect-ios__drop-selected">
            <Package size={22} aria-hidden />
            <div>
              <div className="public-collect-ios__drop-name mono">{uploadFile.name}</div>
              <div className="muted text-xs">{formatIdeviceBytes(uploadFile.size)}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setUploadFile(null);
              }}
            >
              {t("collector.iosUploadClear")}
            </Button>
          </div>
        ) : (
          <div className="public-collect-ios__drop-empty">
            <AppleIcon size={28} className="public-collect-ios__drop-icon" />
            <span className="public-collect-ios__drop-prompt">{t("collector.iosDropPrompt")}</span>
            <span className="muted text-xs">{t("collector.iosDropFormats")}</span>
            <span className="public-collect-ios__drop-browse">{t("collector.iosDropBrowse")}</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".tar.gz,.tgz,.gz,application/gzip,application/x-gzip"
          disabled={disabled || busy}
          hidden
          onChange={(e) => acceptUploadFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="public-collect-ios__actions">
        <Button
          type="button"
          disabled={disabled || busy || !uploadFile}
          onClick={() => void submitUploadFile()}
        >
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} />}
          {busy ? t("collector.working") : t("collector.iosUploadAnalyze")}
        </Button>
      </div>
    </div>
  );

  let body: ReactNode;
  if (tab === "upload") {
    body = uploadPanel;
  } else if (wasmMissing) {
    body = (
      <div className="public-collect-ios__workspace">
        <p className="muted text-sm public-collect__warn">{t("collector.ideviceMissing")}</p>
        <p className="muted text-xs">{t("collector.iosUploadFallbackHint")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setTab("upload")}>
          {t("collector.iosTabUpload")}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="public-collect-ios__workspace">
        <details className="public-collect-ios__trigger">
          <summary>{t("collector.iosTriggerTitle")}</summary>
          <ol>
            <li>{t("collector.iosStepTrigger")}</li>
            <li>{t("collector.iosStepConnect")}</li>
            <li>{t("collector.iosStepPair")}</li>
            <li>{t("collector.iosStepPull")}</li>
          </ol>
        </details>

        <div className="public-collect-ios__status" aria-label={t("collector.iosStatusLabel")}>
          <div className={`public-collect-ios__status-item is-${statusState(!!device)}`}>
            <span className="public-collect-ios__pill" aria-hidden />
            <div>
              <div className="public-collect-ios__status-label">{t("collector.iosStatusDevice")}</div>
              <div className="public-collect-ios__status-value">{deviceLabel}</div>
            </div>
          </div>
          <div
            className={`public-collect-ios__status-item is-${statusState(paired, !!device && !paired)}`}
          >
            <span className="public-collect-ios__pill" aria-hidden />
            <div>
              <div className="public-collect-ios__status-label">{t("collector.iosStatusPair")}</div>
              <div className="public-collect-ios__status-value">{pairLabel}</div>
            </div>
          </div>
          <div
            className={`public-collect-ios__status-item is-${
              error && !busy ? "warn" : busy || progress ? "ok" : "off"
            }`}
          >
            <span className="public-collect-ios__pill" aria-hidden />
            <div>
              <div className="public-collect-ios__status-label">{t("collector.iosStatusAction")}</div>
              <div className="public-collect-ios__status-value" title={jobLabel}>
                {jobLabel}
              </div>
            </div>
          </div>
        </div>

        <section className="public-collect-ios__step">
          <h3>
            <span className="public-collect-ios__step-num">1</span>
            <span className="public-collect-ios__step-ttl">{t("collector.iosStepDeviceTitle")}</span>
          </h3>
          <p className="muted text-xs">{t("collector.iosStepDeviceHint")}</p>
          <div className="public-collect-ios__actions">
            <Button
              type="button"
              disabled={disabled || busy || wasmReady !== true}
              onClick={() => void pickDevice()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              {t("collector.iosPickDevice")}
            </Button>
          </div>
        </section>

        <section className="public-collect-ios__step">
          <h3>
            <span className="public-collect-ios__step-num">2</span>
            <span className="public-collect-ios__step-ttl">{t("collector.iosStepPairTitle")}</span>
          </h3>
          <p className="muted text-xs">{t("collector.iosStepPairHint")}</p>
          <div className="public-collect-ios__actions">
            <Button
              type="button"
              disabled={disabled || busy || !device}
              onClick={() => void pairDevice()}
            >
              {t("collector.iosPair")}
            </Button>
            <label className="public-collect__file-btn public-collect__file-btn--sm">
              {t("collector.iosLoadPair")}
              <input
                type="file"
                accept=".plist,.xml,application/xml,text/xml"
                disabled={disabled || busy}
                hidden
                onChange={(e) => void loadPairFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {paired ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                onClick={clearPair}
              >
                {t("collector.iosClearPair")}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="public-collect-ios__step">
          <h3>
            <span className="public-collect-ios__step-num">3</span>
            <span className="public-collect-ios__step-ttl">{t("collector.iosStepArchivesTitle")}</span>
          </h3>
          <p className="muted text-xs">
            {device
              ? t("collector.iosDeviceConnected", { name: device.productName || "Apple device" })
              : t("collector.iosArchivesHint")}
          </p>
          <div className="public-collect-ios__actions">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || busy || !device || !paired}
              onClick={() => void refreshList()}
            >
              <RefreshCw size={14} aria-hidden />
              {t("collector.iosRefreshArchives")}
            </Button>
          </div>

          {archives.length > 0 ? (
            <div className="public-collect-ios__picker">
              <div className="public-collect-ios__picker-head">
                <div>
                  <div className="public-collect-ios__picker-title">
                    {t("collector.iosPickerTitle")}
                  </div>
                  <div className="muted text-xs">
                    {t("collector.iosPickerCount", { count: archives.length })}
                  </div>
                </div>
              </div>
              <p className="muted text-xs">{t("collector.iosPickerHint")}</p>
              <ul className="public-collect-ios__archive-list" role="listbox">
                {archives.map((a) => (
                  <li key={a.path}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedPath === a.path}
                      className={`public-collect-ios__archive-item${
                        selectedPath === a.path ? " is-selected" : ""
                      }`}
                      disabled={disabled || busy}
                      onClick={() => setSelectedPath(a.path)}
                    >
                      <span className="public-collect-ios__archive-icon" aria-hidden>
                        <Package size={16} />
                      </span>
                      <span className="public-collect-ios__archive-body">
                        <span className="public-collect-ios__archive-name mono">{a.name}</span>
                        <span className="muted text-xs public-collect-ios__archive-path">
                          {a.path}
                        </span>
                      </span>
                      <span className="muted text-xs mono">{formatIdeviceBytes(a.sizeBytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected ? (
                <div className="public-collect-ios__selected">
                  <div className="public-collect-ios__selected-row">
                    <Package size={18} aria-hidden />
                    <div>
                      <div className="public-collect-ios__selected-title mono">{selected.name}</div>
                      <div className="muted text-xs">{selected.path}</div>
                    </div>
                    <span className="mono text-xs">{formatIdeviceBytes(selected.sizeBytes)}</span>
                  </div>
                  <Button
                    type="button"
                    disabled={disabled || busy || !device || !selectedPath}
                    onClick={() => void collectSelected()}
                  >
                    <Upload size={14} aria-hidden />
                    {busy ? t("collector.working") : t("collector.iosCollectSelected")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {progress ? <p className="mono text-xs muted public-collect-ios__progress">{progress}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="public-collect-ios">
      <header className="public-collect-ios__intro">
        <h2 className="public-collect-ios__title">
          <AppleIcon size={18} />
          {t("collector.iosWorkspaceTitle")}
        </h2>
        <p className="muted text-sm">{t("collector.iosWorkspaceLead")}</p>
      </header>

      {tabs}
      {body}
      {error ? <p className="error text-xs public-collect-ios__error">{error}</p> : null}
    </div>
  );
}
