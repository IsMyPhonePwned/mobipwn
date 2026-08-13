import { useMemo } from "react";
import { Loader2, Shield } from "lucide-react";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_DEVICE_HEADER_PANEL_ID } from "@/lib/caseDashboard";
import {
  BUGREPORT_HEADER_DETAILS,
  BUGREPORT_HEADER_PRIMARY,
  bugreportHeaderLabel,
  bugreportHeaderMap,
  headerFieldsFromRow,
  kernelSummaryLabel,
  parseBuildFingerprint,
  parseKeyValueTokens,
  parseLinuxKernelString,
} from "@/lib/bugreportHeader";
import type { CasePlatform } from "@/lib/caseDashboard";
import {
  lockdowndDeviceMapFromRows,
  lockdowndDeviceMapHasIdentity,
} from "@/lib/iosLockdowndDevice";
import {
  remotectlDetailSections,
  remotectlDeviceFields,
  remotectlHeroStats,
  remotectlHeroSubtitle,
  remotectlHeroTitle,
  remotectlProductName,
} from "@/lib/remotectlDevice";

const IOS_DEVICE_FIELDS =
  "| fields timestamp, parser, message, device_model, os_version, device_id, product_type, build_version, unique_device_id, ext, action | head 8";

function isIngestedIosDeviceRow(row: Record<string, unknown>): boolean {
  const parser = String(row.parser ?? "");
  const action = String(row.action ?? "");
  return (
    (parser === "remotectl_dumpstate" && action === "device_metadata") ||
    (parser === "ioservice" && action === "device_properties") ||
    (parser === "lockdownd" && action === "device_metadata")
  );
}

function pickField(rows: Record<string, unknown>[], keys: string[]): string {
  for (const row of rows) {
    for (const key of keys) {
      const v = row[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return "";
}

function KernelDetailBody({ value }: { value: string }) {
  const kernel = parseLinuxKernelString(value);
  if (!kernel) {
    return <pre className="case-device-header-detail__body mono">{value}</pre>;
  }

  return (
    <div className="case-device-header-kernel">
      <div className="case-device-header-kernel__hero">
        <span className="case-device-header-kernel__version mono">{kernel.versionBase || kernel.version}</span>
        <div className="case-device-header-kernel__tags">
          {kernel.androidRelease && (
            <span className="case-device-header-kernel__tag">
              Android {kernel.androidRelease}
              {kernel.androidPatch ? `.${kernel.androidPatch}` : ""}
            </span>
          )}
          {kernel.buildId && <span className="case-device-header-kernel__tag mono">{kernel.buildId}</span>}
          {kernel.suffix && <span className="case-device-header-kernel__tag muted">{kernel.suffix}</span>}
        </div>
      </div>

      <dl className="case-device-header-kernel__grid">
        {kernel.buildHost && (
          <>
            <dt>Built by</dt>
            <dd className="mono">{kernel.buildHost}</dd>
          </>
        )}
        {(kernel.clangVersion || kernel.lldVersion) && (
          <>
            <dt>Toolchain</dt>
            <dd className="mono">
              {[kernel.clangVersion && `clang ${kernel.clangVersion}`, kernel.lldVersion && `LLD ${kernel.lldVersion}`]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </>
        )}
        {kernel.androidBuild && (
          <>
            <dt>Android build</dt>
            <dd className="mono">{kernel.androidBuild}</dd>
          </>
        )}
        {kernel.toolchainFlags && (
          <>
            <dt>Optimizations</dt>
            <dd>{kernel.toolchainFlags}</dd>
          </>
        )}
        {kernel.toolchainRevision && (
          <>
            <dt>LLVM revision</dt>
            <dd className="mono">{kernel.toolchainRevision}</dd>
          </>
        )}
        {kernel.buildNumber && (
          <>
            <dt>Build</dt>
            <dd className="mono">
              {[kernel.buildNumber, kernel.kernelFlags].filter(Boolean).join(" ")}
            </dd>
          </>
        )}
        {kernel.buildDate && (
          <>
            <dt>Built on</dt>
            <dd>{kernel.buildDate}</dd>
          </>
        )}
      </dl>

      <details className="case-device-header-kernel__raw">
        <summary className="muted text-xs">Full uname string</summary>
        <pre className="case-device-header-detail__body mono">{kernel.raw}</pre>
      </details>
    </div>
  );
}

function KeyValueDetailBody({ value }: { value: string }) {
  const tokens = parseKeyValueTokens(value);
  if (tokens.length < 2) {
    return <pre className="case-device-header-detail__body mono">{value}</pre>;
  }

  return (
    <dl className="case-device-header-kv">
      {tokens.map((token, index) => (
        <div key={`${token.key}-${index}`} className="case-device-header-kv__row">
          <dt className="mono">{token.key}</dt>
          <dd className="mono">{token.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function HeaderDetailBody({ label, value }: { label: string; value: string }) {
  if (label === "Kernel") return <KernelDetailBody value={value} />;
  if (label === "Command line" || label === "Dumpstate info") {
    return <KeyValueDetailBody value={value} />;
  }
  return <pre className="case-device-header-detail__body mono">{value}</pre>;
}

function headerDetailSummary(label: string, value: string): string {
  const display = bugreportHeaderLabel(label);
  if (label === "Kernel") {
    const short = kernelSummaryLabel(value);
    return short && short !== value ? `${display} · ${short}` : display;
  }
  if (label === "Command line" || label === "Dumpstate info") {
    const count = parseKeyValueTokens(value).length;
    return count > 1 ? `${display} · ${count} fields` : display;
  }
  return display;
}

function AndroidStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="case-android-device__stat">
      <span className="case-android-device__stat-label">{label}</span>
      <span className={`case-android-device__stat-value${mono ? " mono" : ""}`}>{value}</span>
    </div>
  );
}

function BugreportHeaderView({
  fields,
  deviceModel,
  osVersion,
  deviceId,
}: {
  fields: ReturnType<typeof headerFieldsFromRow>;
  deviceModel: string;
  osVersion: string;
  deviceId: string;
}) {
  const map = useMemo(() => bugreportHeaderMap(fields), [fields]);
  const fingerprint = map.get("build fingerprint") ?? map.get("build") ?? "";
  const fp = useMemo(() => parseBuildFingerprint(fingerprint), [fingerprint]);
  const build = map.get("build") ?? "";
  const sdk = map.get("android sdk version") ?? "";
  const timestamp = map.get("timestamp") ?? "";
  const uptime = map.get("uptime") ?? "";
  const radio = map.get("radio") ?? "";
  const bootloader = map.get("bootloader") ?? "";
  const network = map.get("network") ?? "";

  const modelName =
    deviceModel ||
    fp.product ||
    fp.device ||
    fp.brand ||
    build.split(".")[0] ||
    "Android device";

  const releaseLabel = fp.release
    ? `Android ${fp.release}`
    : osVersion
      ? osVersion
      : sdk
        ? `API ${sdk}`
        : "";
  const buildLabel = fp.buildId || (build && build !== fingerprint ? build.split(".")[0] : "");

  const subtitle = [
    releaseLabel,
    sdk && releaseLabel && !releaseLabel.includes(String(sdk)) ? `API ${sdk}` : null,
    buildLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const identityBits = [
    fp.brand,
    fp.product && fp.product !== fp.brand ? fp.product : null,
    fp.device && fp.device !== fp.product ? fp.device : null,
    fp.type,
    fp.tags,
  ].filter(Boolean) as string[];

  const shown = new Set<string>([
    "timestamp",
    "uptime",
    "android sdk version",
    "build",
    "build fingerprint",
    "radio",
    "bootloader",
    "network",
  ]);

  const detailFields = BUGREPORT_HEADER_DETAILS.map((key) => {
    const value = map.get(key.toLowerCase());
    if (!value) return null;
    shown.add(key.toLowerCase());
    return (
      <details key={key} className="case-android-device__detail">
        <summary>{headerDetailSummary(key, value)}</summary>
        <div className="case-android-device__detail-body">
          <HeaderDetailBody label={key} value={value} />
        </div>
      </details>
    );
  }).filter(Boolean);

  const extraPrimary = BUGREPORT_HEADER_PRIMARY.map((key) => {
    const lower = key.toLowerCase();
    if (shown.has(lower)) return null;
    const value = map.get(lower);
    if (!value) return null;
    shown.add(lower);
    return { key, value };
  }).filter(Boolean) as Array<{ key: string; value: string }>;

  const extraFields = fields.filter((f) => !shown.has(f.key.toLowerCase()));

  const stats = [
    deviceId ? { label: "Serial", value: deviceId, mono: true } : null,
    sdk ? { label: "API", value: sdk, mono: true } : null,
    buildLabel ? { label: "Build ID", value: buildLabel, mono: true } : null,
    uptime ? { label: "Uptime", value: uptime, mono: false } : null,
    timestamp ? { label: "Captured", value: timestamp, mono: true } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; mono: boolean }>;

  const radioBits = [
    radio ? { label: "Radio", value: radio } : null,
    bootloader ? { label: "Bootloader", value: bootloader } : null,
    network ? { label: "Network", value: network } : null,
    ...extraPrimary.map((f) => ({ label: bugreportHeaderLabel(f.key), value: f.value })),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="case-android-device">
      <header className="case-android-device__hero">
        <div className="case-android-device__hero-main">
          <div className="case-android-device__icon" aria-hidden>
            <CasePlatformIcon platform="android" size={22} />
          </div>
          <div className="case-android-device__hero-text">
            <p className="case-android-device__eyebrow">Bugreport device</p>
            <h3 className="case-android-device__title">{modelName}</h3>
            {subtitle ? <p className="case-android-device__subtitle">{subtitle}</p> : null}
            {identityBits.length > 0 ? (
              <p className="case-android-device__codenames muted text-xs mono">{identityBits.join(" / ")}</p>
            ) : null}
          </div>
        </div>
      </header>

      {stats.length > 0 ? (
        <div className="case-android-device__stats" aria-label="Device snapshot">
          {stats.map((s) => (
            <AndroidStat key={s.label} label={s.label} value={s.value} mono={s.mono} />
          ))}
        </div>
      ) : null}

      <div className="case-android-device__scroll">
        {fingerprint && fingerprint.includes("/") ? (
          <section className="case-android-device__block">
            <h4 className="case-android-device__block-title">Build fingerprint</h4>
            <code className="case-android-device__fingerprint">
              {fingerprint.replace(/^['"]|['"]$/g, "")}
            </code>
          </section>
        ) : null}

        {radioBits.length > 0 ? (
          <section className="case-android-device__block">
            <h4 className="case-android-device__block-title">
              <Shield size={13} aria-hidden />
              Radio & boot
            </h4>
            <dl className="case-android-device__kv">
              {radioBits.map((bit) => (
                <div key={bit.label} className="case-android-device__kv-row">
                  <dt>{bit.label}</dt>
                  <dd className="mono">{bit.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {detailFields.length > 0 ? (
          <section className="case-android-device__block">
            <h4 className="case-android-device__block-title">System details</h4>
            <div className="case-android-device__details">{detailFields}</div>
          </section>
        ) : null}

        {extraFields.length > 0 ? (
          <details className="case-android-device__more">
            <summary>Other header fields ({extraFields.length})</summary>
            <dl className="case-android-device__kv case-android-device__kv--dense">
              {extraFields.map((f) => (
                <div key={f.key} className="case-android-device__kv-row">
                  <dt>{bugreportHeaderLabel(f.key)}</dt>
                  <dd className="mono">{f.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function IosStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="case-ios-device__stat">
      <span className="case-ios-device__stat-label">{label}</span>
      <span className={`case-ios-device__stat-value${mono ? " mono" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function IosRemotectlHeaderView({
  row,
  deviceMap,
  sourceNote,
}: {
  row: Record<string, unknown>;
  deviceMap?: Map<string, string>;
  sourceNote?: string;
}) {
  const map = useMemo(
    () => deviceMap ?? remotectlDeviceFields(row),
    [deviceMap, row]
  );
  const title = remotectlHeroTitle(map);
  const subtitle = remotectlHeroSubtitle(map);
  const productName = remotectlProductName(map);
  const stats = useMemo(() => remotectlHeroStats(map), [map]);
  const sections = useMemo(() => remotectlDetailSections(map), [map]);
  const parser = String(row.parser ?? "").trim();

  return (
    <div className="case-ios-device">
      <header className="case-ios-device__hero">
        <div className="case-ios-device__hero-main">
          <div className="case-ios-device__icon" aria-hidden>
            <CasePlatformIcon platform="ios" size={22} />
          </div>
          <div className="case-ios-device__hero-text">
            <p className="case-ios-device__eyebrow">Sysdiagnose device</p>
            <h3 className="case-ios-device__title">{title}</h3>
            {subtitle ? <p className="case-ios-device__subtitle">{subtitle}</p> : null}
            {productName && productName !== title ? (
              <p className="case-ios-device__product muted text-xs">{productName}</p>
            ) : null}
            {parser ? (
              <p className="case-ios-device__source muted text-xs">
                Source <span className="mono">{parser}</span>
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {stats.length > 0 ? (
        <div className="case-ios-device__stats" aria-label="Device snapshot">
          {stats.map((s) => (
            <IosStat key={s.label} label={s.label} value={s.value} mono={s.mono} />
          ))}
        </div>
      ) : null}

      <div className="case-ios-device__scroll">
        {sections.map((section) => (
          <section key={section.title} className="case-ios-device__block">
            <h4 className="case-ios-device__block-title">
              {section.title === "Security" ? <Shield size={13} aria-hidden /> : null}
              {section.title}
            </h4>
            <dl className="case-ios-device__kv">
              {section.fields.map((field) => (
                <div key={`${section.title}:${field.label}`} className="case-ios-device__kv-row">
                  <dt>{field.label}</dt>
                  <dd className={field.mono ? "mono" : undefined} title={field.value}>
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {sourceNote ? <p className="case-ios-device__note muted text-xs">{sourceNote}</p> : null}
      </div>
    </div>
  );
}

function bestIosDeviceRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const score = (row: Record<string, unknown>) => {
    const map = remotectlDeviceFields(row);
    const action = String(row.action ?? "");
    return (
      (map.get("device_model") ? 4 : 0) +
      (map.get("os_version") ? 4 : 0) +
      (map.get("serial") || map.get("device_id") ? 3 : 0) +
      (row.parser === "remotectl_dumpstate" ? 4 : 0) +
      (row.parser === "lockdownd" ? 2 : 0) +
      (action === "device_metadata" ? 3 : 0) +
      (action === "device_properties" ? 1 : 0)
    );
  };
  return rows.reduce<Record<string, unknown>>(
    (best, row) => (score(row) > score(best) ? row : best),
    rows[0] ?? {}
  );
}

function useIosDevicePanels(ingestSource: string, refreshKey: number, enabled: boolean) {
  const src = escapeMplString(ingestSource);
  const remotectlPanel = useMemo(
    (): DashboardPanel => ({
      id: CASE_DEVICE_HEADER_PANEL_ID,
      title: "Device remotectl",
      query: `source="${src}" parser="remotectl_dumpstate" ${IOS_DEVICE_FIELDS}`,
      viz: "table",
      layout: { i: CASE_DEVICE_HEADER_PANEL_ID, x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
    }),
    [src]
  );
  const ioservicePanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_DEVICE_HEADER_PANEL_ID}_ioservice`,
      title: "Device ioservice",
      query: `source="${src}" parser="ioservice" action="device_properties" ${IOS_DEVICE_FIELDS}`,
      viz: "table",
      layout: { i: `${CASE_DEVICE_HEADER_PANEL_ID}_ioservice`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );
  const lockdowndMetaPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_DEVICE_HEADER_PANEL_ID}_lockmeta`,
      title: "Device lockdownd meta",
      query: `source="${src}" parser="lockdownd" action="device_metadata" ${IOS_DEVICE_FIELDS}`,
      viz: "table",
      layout: { i: `${CASE_DEVICE_HEADER_PANEL_ID}_lockmeta`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );
  const lockdowndPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_DEVICE_HEADER_PANEL_ID}_lockdownd`,
      title: "Device lockdownd",
      query: `source="${src}" parser="lockdownd" | fields timestamp, message, ext | head 120`,
      viz: "table",
      layout: { i: `${CASE_DEVICE_HEADER_PANEL_ID}_lockdownd`, x: 0, y: 0, w: 1, h: 1 },
    }),
    [src]
  );

  const remotectl = useDashboardPanel(remotectlPanel, "24h", refreshKey, enabled);
  const ioservice = useDashboardPanel(ioservicePanel, "24h", refreshKey, enabled);
  const lockdowndMeta = useDashboardPanel(lockdowndMetaPanel, "24h", refreshKey, enabled);
  const lockdownd = useDashboardPanel(lockdowndPanel, "24h", refreshKey, enabled);

  return { remotectl, ioservice, lockdowndMeta, lockdownd };
}

export function CaseDeviceHeaderPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const isIos = platform === "ios";
  const androidPanel = useMemo((): DashboardPanel => {
    const src = escapeMplString(ingestSource);
    return {
      id: CASE_DEVICE_HEADER_PANEL_ID,
      title: "Device",
      query: `source="${src}" parser="Header" | head 1`,
      viz: "table",
      layout: { i: CASE_DEVICE_HEADER_PANEL_ID, x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
    };
  }, [ingestSource]);

  const iosQueries = useIosDevicePanels(ingestSource, refreshKey, isIos);
  const androidQuery = useDashboardPanel(androidPanel, "24h", refreshKey, !isIos);

  const rows = isIos ? iosQueries.remotectl.rows : androidQuery.rows;
  const loading = isIos
    ? iosQueries.remotectl.loading ||
      iosQueries.ioservice.loading ||
      iosQueries.lockdowndMeta.loading ||
      iosQueries.lockdownd.loading
    : androidQuery.loading;
  const error = isIos
    ? iosQueries.remotectl.error || iosQueries.ioservice.error || iosQueries.lockdowndMeta.error
    : androidQuery.error;

  const iosCandidateRows = useMemo(() => {
    if (!isIos) return [];
    const merged = [
      ...iosQueries.remotectl.rows,
      ...iosQueries.ioservice.rows,
      ...iosQueries.lockdowndMeta.rows,
    ];
    const seen = new Set<string>();
    return merged.filter((row) => {
      const key = `${row.timestamp ?? ""}:${row.parser ?? ""}:${row.action ?? ""}:${row.message ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [
    isIos,
    iosQueries.remotectl.rows,
    iosQueries.ioservice.rows,
    iosQueries.lockdowndMeta.rows,
  ]);

  const headerRow = useMemo(
    () => (isIos && iosCandidateRows.length ? bestIosDeviceRow(iosCandidateRows) : rows[0] ?? {}),
    [isIos, iosCandidateRows, rows]
  );
  const iosDeviceMap = useMemo(() => {
    if (!isIos) return new Map<string, string>();
    const remotectl = remotectlDeviceFields(headerRow);
    if (remotectl.size > 0) return remotectl;
    const lockdownd = lockdowndDeviceMapFromRows(iosQueries.lockdownd.rows);
    return lockdowndDeviceMapHasIdentity(lockdownd) ? lockdownd : new Map();
  }, [isIos, headerRow, iosQueries.lockdownd.rows]);
  const iosDeviceFromLockdownd = useMemo(() => {
    if (!isIos || iosDeviceMap.size === 0) return false;
    return !iosCandidateRows.some(isIngestedIosDeviceRow);
  }, [isIos, iosDeviceMap.size, iosCandidateRows]);
  const iosDeviceSourceNote = useMemo(() => {
    if (!iosDeviceFromLockdownd) return undefined;
    return "Indexed device metadata missing — restart mobipwn-api, then re-ingest this sysdiagnose.";
  }, [iosDeviceFromLockdownd]);

  const model = pickField(rows, ["device_model", "model", "Build"]);
  const os = pickField(rows, ["os_version", "version", "Android SDK version"]);
  const deviceId = pickField(rows, ["device_id", "serial"]);
  const fields = useMemo(() => (rows.length ? headerFieldsFromRow(headerRow) : []), [headerRow, rows.length]);

  if (loading && rows.length === 0) {
    return (
      <div className="case-device-header case-device-header--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-device-header case-device-header--error muted text-xs">{error}</p>;
  }

  if (isIos) {
    if (iosDeviceMap.size === 0) {
      return (
        <p className="case-device-header case-device-header--empty muted text-xs">
          No device metadata yet — re-ingest this sysdiagnose so remotectl_dumpstate and ioservice rows are
          indexed.
        </p>
      );
    }
    return (
      <IosRemotectlHeaderView
        row={headerRow}
        deviceMap={iosDeviceMap}
        sourceNote={iosDeviceSourceNote}
      />
    );
  }

  if (!fields.length && !model && !os && !deviceId) {
    return (
      <p className="case-device-header case-device-header--empty muted text-xs">
        {isIos
          ? "No remotectl_dumpstate device metadata for this case yet."
          : "No Header parser metadata for this case yet."}
      </p>
    );
  }

  if (fields.length > 0) {
    return (
      <BugreportHeaderView
        fields={fields}
        deviceModel={model}
        osVersion={os}
        deviceId={deviceId}
      />
    );
  }

  return (
    <dl className="case-device-header">
      {model && (
        <>
          <dt>Model</dt>
          <dd>{model}</dd>
        </>
      )}
      {os && (
        <>
          <dt>OS</dt>
          <dd className="mono">{os}</dd>
        </>
      )}
      {deviceId && (
        <>
          <dt>Device ID</dt>
          <dd className="mono">{deviceId}</dd>
        </>
      )}
    </dl>
  );
}
