import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ExternalLink,
  GitCompare,
  Link2,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLocale } from "@/contexts/LocaleContext";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/SectionHeader";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import {
  buildCompareSearchParams,
  caseIdentityBits,
  compareCases,
  compareDeviceIdentity,
  comparePagePath,
  comparePageUrl,
  fetchEligibleComparisonCases,
  identityVerdict,
  isCompareSignalType,
  packageInventoryStatus,
  parseCompareSearchParams,
  preferredDiffSection,
  primarySpotId,
  shortHash,
  signalSectionDeltas,
  type CaseComparisonResult,
  type CompareCaseMeta,
  type CompareEntityItem,
  type ComparePlatform,
  type EligibleCase,
  type EntityCompareSection,
} from "@/lib/caseComparison";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { formatRelativeCompact, formatWallTimestamp } from "@/lib/formatRelative";
import { buildSearchHref } from "@/lib/mplQuery";
import { entitySearchQuery } from "@/lib/entitySearch";

type CompareTab = "only_a" | "only_b" | "shared";

/** Keep comparison state when drilling into cases or search. */
const OPEN_IN_NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

const TAB_META: Record<
  CompareTab,
  { label: string; hint: string; tone: "new" | "shared" | "removed" }
> = {
  only_b: {
    label: "New in B",
    hint: "Entities present in the compare case but not in the baseline.",
    tone: "new",
  },
  shared: {
    label: "In both",
    hint: "Entities seen in both cases — counts may differ.",
    tone: "shared",
  },
  only_a: {
    label: "Only in A",
    hint: "Entities in the baseline that are missing from the compare case.",
    tone: "removed",
  },
};

function matchesCaseFilter(c: EligibleCase, q: string): boolean {
  if (!q) return true;
  const haystack = [
    c.title,
    c.ingest_source ?? "",
    c.user,
    c.description,
    c.status,
    c.priority,
    c.id,
    c.device_model ?? "",
    c.os_version ?? "",
    c.device_id ?? "",
    c.serial_number ?? "",
    c.android_id ?? "",
    c.unique_device_id ?? "",
    c.imei ?? "",
    c.blob_file_hash ?? "",
    ...c.tags,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatRelativeCompact(d);
}

function CaseMetaLine({ c }: { c: EligibleCase }) {
  const deviceLine = [c.device_model, c.os_version].filter(Boolean).join(" · ");
  const identity = caseIdentityBits(c);
  const spot = primarySpotId(c);
  // Primary spot is shown beside the title; keep secondary ids here.
  const secondary = identity.filter((bit) => bit.label !== spot?.label);
  const parts: string[] = [];
  if (c.ingest_source) parts.push(c.ingest_source);
  if (c.event_count != null) parts.push(`${c.event_count.toLocaleString()} events`);
  if (c.user) parts.push(c.user);
  const when = formatWhen(c.last_ingest_at ?? c.first_ingest_at);
  if (when) parts.push(when);
  return (
    <div className="case-compare-case-row__meta-wrap">
      {deviceLine ? (
        <p className="case-compare-case-row__device text-xs">{deviceLine}</p>
      ) : null}
      {secondary.length > 0 ? (
        <p className="case-compare-case-row__ids text-xs mono" aria-label="Identifiers">
          {secondary.map((bit, i) => (
            <span key={bit.label} className="case-compare-case-row__id" title={bit.title ?? bit.value}>
              {i > 0 ? <span className="case-compare-case-row__id-sep"> · </span> : null}
              <span className="case-compare-case-row__id-label muted">{bit.label}</span>{" "}
              <span>{bit.value}</span>
            </span>
          ))}
        </p>
      ) : null}
      <p className="case-compare-case-row__meta muted text-xs">{parts.join(" · ")}</p>
    </div>
  );
}

function CasePicker({
  label,
  cases,
  value,
  onChange,
  excludeId,
}: {
  label: string;
  cases: EligibleCase[];
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
}) {
  const selected = useMemo(
    () => (value ? cases.find((c) => c.id === value) ?? null : null),
    [cases, value]
  );

  return (
    <div className="case-compare-picker">
      <div className="case-compare-picker__head">
        <span className="case-compare-picker__label">{label}</span>
        {selected && (
          <Button variant="ghost" size="sm" type="button" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>
      <div className="case-compare-picker__list" role="listbox" aria-label={label}>
        {cases.length === 0 ? (
          <p className="muted text-xs case-compare-picker__empty">No matching cases.</p>
        ) : (
          cases.map((c) => {
            const isSelected = value === c.id;
            const isExcluded = excludeId === c.id;
            const spot = primarySpotId(c);
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isExcluded}
                title={
                  isExcluded
                    ? "Already selected for the other case"
                    : [
                        caseIdentityBits(c)
                          .map((b) => `${b.label} ${b.title ?? b.value}`)
                          .join(" · "),
                        c.description,
                        c.tags.join(", "),
                      ]
                        .filter(Boolean)
                        .join(" — ")
                }
                className={`case-compare-case-row${isSelected ? " case-compare-case-row--selected" : ""}${isExcluded ? " case-compare-case-row--disabled" : ""}`}
                onClick={() => onChange(c.id)}
              >
                <div className="case-compare-case-row__head">
                  <div className="case-compare-case-row__title-wrap">
                    <span className="case-compare-case-row__title">{c.title}</span>
                    {spot ? (
                      <span
                        className="case-compare-case-row__spot mono"
                        title={`${spot.label} ${spot.title ?? spot.value}`}
                      >
                        <span className="case-compare-case-row__spot-label">{spot.label}</span>{" "}
                        {spot.value}
                      </span>
                    ) : null}
                  </div>
                  {isSelected && <span className="case-compare-case-row__check">✓</span>}
                </div>
                <CaseMetaLine c={c} />
                {c.tags.length > 0 && (
                  <div className="case-compare-case-row__tags">
                    {c.tags.slice(0, 6).map((tag) => (
                      <span key={tag} className="pill">
                        {tag}
                      </span>
                    ))}
                    {c.tags.length > 6 && (
                      <span className="muted text-xs">+{c.tags.length - 6}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
      {selected && (
        <div className="case-compare-picker__footer">
          <Link
            to={`/cases/${selected.id}`}
            className="case-compare-picker__open"
            {...OPEN_IN_NEW_TAB}
          >
            <ExternalLink size={12} aria-hidden />
            Open case
          </Link>
        </div>
      )}
    </div>
  );
}

function CaseSideSummary({
  side,
  meta,
  tone,
}: {
  side: "A" | "B";
  meta: CompareCaseMeta;
  tone: "baseline" | "compare";
}) {
  const fields: { label: string; value: string; title?: string }[] = [
    { label: "Source", value: meta.ingest_source },
  ];
  if (meta.event_count != null) {
    fields.push({ label: "Events", value: meta.event_count.toLocaleString() });
  }
  if (meta.case_user) fields.push({ label: "Owner", value: meta.case_user });
  if (meta.device_model) fields.push({ label: "Model", value: meta.device_model });
  if (meta.product_name) fields.push({ label: "Product", value: meta.product_name });
  if (meta.os_version) fields.push({ label: "OS", value: meta.os_version });
  if (meta.build_id) fields.push({ label: "Build", value: meta.build_id });
  if (meta.sdk) fields.push({ label: "SDK", value: meta.sdk });
  const serial = meta.serial_number || (meta.platform === "android" ? meta.device_id : null);
  if (serial) fields.push({ label: "Serial", value: serial });
  if (meta.imei) fields.push({ label: "IMEI", value: meta.imei });
  if (meta.meid) fields.push({ label: "MEID", value: meta.meid });
  if (meta.android_id) fields.push({ label: "Android ID", value: meta.android_id });
  if (meta.platform !== "android" && meta.device_id && meta.device_id !== serial) {
    fields.push({ label: "Device ID", value: meta.device_id });
  }
  if (meta.unique_device_id) fields.push({ label: "UDID", value: meta.unique_device_id });
  if (meta.build_fingerprint) {
    fields.push({
      label: "Fingerprint",
      value: meta.build_fingerprint,
      title: meta.build_fingerprint,
    });
  }
  if (meta.blob_file_name) fields.push({ label: "Archive", value: meta.blob_file_name });
  if (meta.blob_file_hash) {
    fields.push({
      label: "SHA-256",
      value: shortHash(meta.blob_file_hash, 16),
      title: meta.blob_file_hash,
    });
  }
  const ingestWhen = meta.last_ingest_at ?? meta.first_ingest_at;
  if (ingestWhen) {
    const d = new Date(ingestWhen);
    if (!Number.isNaN(d.getTime())) {
      fields.push({
        label: "Ingested",
        value: formatRelativeCompact(d),
        title: formatWallTimestamp(ingestWhen),
      });
    }
  }
  if (meta.blob_created_at) {
    const d = new Date(meta.blob_created_at);
    if (!Number.isNaN(d.getTime())) {
      fields.push({
        label: "Blob stored",
        value: formatRelativeCompact(d),
        title: formatWallTimestamp(meta.blob_created_at),
      });
    }
  }

  return (
    <div className={`case-compare-side case-compare-side--${tone}`}>
      <span className="case-compare-side__badge">Case {side}</span>
      <Link
        to={`/cases/${meta.case_id}`}
        className="case-compare-side__title"
        {...OPEN_IN_NEW_TAB}
      >
        {meta.title}
      </Link>
      <dl className="case-compare-side__fields">
        {fields.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd className="mono" title={f.title ?? f.value}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DeviceIdentityPanel({ result }: { result: CaseComparisonResult }) {
  const { t } = useLocale();
  const platform: ComparePlatform = result.platform === "ios" ? "ios" : "android";
  const rows = useMemo(
    () => compareDeviceIdentity(result.case_a, result.case_b, platform),
    [result.case_a, result.case_b, platform],
  );
  const verdict = useMemo(() => identityVerdict(rows), [rows]);
  const tone =
    verdict.sameDevice === true && verdict.differentUpload === true
      ? "same-upload-diff"
      : verdict.sameDevice === false
        ? "diff-device"
        : verdict.sameDevice === true
          ? "same-device"
          : "unknown";

  return (
    <section className={`case-compare-identity case-compare-identity--${tone}`}>
      <div className="case-compare-identity__head">
        <h3 className="case-compare-identity__title">{t("caseCompare.identityTitle")}</h3>
        <span className="case-compare-identity__verdict">{verdict.label}</span>
      </div>
      <p className="case-compare-identity__hint muted text-sm">
        {t("caseCompare.identityHint")}
      </p>
      <div className="case-compare-identity__grid">
        <div className="case-compare-identity__col-head" />
        <div className="case-compare-identity__col-head">A</div>
        <div className="case-compare-identity__col-head">B</div>
        <div className="case-compare-identity__col-head" />
        {rows.map((row) => {
          const displayA =
            row.key === "blob_file_hash" ? shortHash(row.valueA, 16) : (row.valueA ?? "—");
          const displayB =
            row.key === "blob_file_hash" ? shortHash(row.valueB, 16) : (row.valueB ?? "—");
          return (
            <div key={row.key} className="case-compare-identity__row">
              <span className="case-compare-identity__label">{row.label}</span>
              <span className="mono case-compare-identity__val" title={row.valueA ?? undefined}>
                {displayA}
              </span>
              <span className="mono case-compare-identity__val" title={row.valueB ?? undefined}>
                {displayB}
              </span>
              <span
                className={`case-compare-identity__status case-compare-identity__status--${row.status}`}
              >
                {row.status === "match" ? "match" : row.status === "mismatch" ? "differ" : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EntityRow({
  row,
  entityType,
  scope,
  tab,
  caseALabel,
  caseBLabel,
}: {
  row: CompareEntityItem;
  entityType: string;
  scope: string;
  tab: CompareTab;
  caseALabel: string;
  caseBLabel: string;
}) {
  return (
    <div className={`case-compare-entity case-compare-entity--${TAB_META[tab].tone}`}>
      <span className="case-compare-entity__value mono" title={row.value}>
        {row.value}
      </span>
      <span className="case-compare-entity__counts">
        {tab === "shared" ? (
          row.count_a === row.count_b ? (
            <span className="case-compare-entity__count">{row.count_a}</span>
          ) : (
            <span className="case-compare-entity__count-delta">
              <span title={caseALabel}>{row.count_a}</span>
              <span aria-hidden>→</span>
              <span title={caseBLabel}>{row.count_b}</span>
            </span>
          )
        ) : tab === "only_a" ? (
          <span className="case-compare-entity__count">{row.count_a}</span>
        ) : (
          <span className="case-compare-entity__count">{row.count_b}</span>
        )}
      </span>
      <Link
        to={buildSearchHref(entitySearchQuery(entityType, row.value, scope), { run: true })}
        className="case-compare-entity__search"
        title="Search in events (new tab)"
        {...OPEN_IN_NEW_TAB}
      >
        <Search size={14} aria-hidden />
        <span className="sr-only">Search</span>
      </Link>
    </div>
  );
}

function EntitySectionBlock({
  section,
  tab,
  scope,
  caseALabel,
  caseBLabel,
  entityFilter,
  defaultOpen,
}: {
  section: EntityCompareSection;
  tab: CompareTab;
  scope: string;
  caseALabel: string;
  caseBLabel: string;
  entityFilter: string;
  defaultOpen: boolean;
}) {
  const items =
    tab === "only_a"
      ? section.only_a
      : tab === "only_b"
        ? section.only_b
        : section.shared;

  const visibleItems = useMemo(() => {
    const q = entityFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => row.value.toLowerCase().includes(q));
  }, [items, entityFilter]);

  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, tab, section.entity_type]);

  if (items.length === 0) return null;

  const tone = isCompareSignalType(section.entity_type) ? "signal" : "telemetry";

  return (
    <section className={`case-compare-block case-compare-block--${tone}`}>
      <button
        type="button"
        className="case-compare-block__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="case-compare-block__title">{section.label}</span>
        <span className="case-compare-block__count">{items.length}</span>
        <ChevronDown
          size={16}
          className={`case-compare-block__chevron${open ? " case-compare-block__chevron--open" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="case-compare-block__body">
          <div className="case-compare-entity-header">
            <span>Value</span>
            <span>
              {tab === "shared" ? "Count A → B" : tab === "only_a" ? caseALabel : caseBLabel}
            </span>
            <span />
          </div>
          {visibleItems.length === 0 ? (
            <p className="muted text-xs case-compare-block__empty">No matches in this section.</p>
          ) : (
            <div className="case-compare-entity-list">
              {visibleItems.map((row) => (
                <EntityRow
                  key={row.value}
                  row={row}
                  entityType={section.entity_type}
                  scope={scope}
                  tab={tab}
                  caseALabel={caseALabel}
                  caseBLabel={caseBLabel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ChangeFocusPanel({ result }: { result: CaseComparisonResult }) {
  const { t } = useLocale();
  const platform: ComparePlatform = result.platform === "ios" ? "ios" : "android";
  const verdict = useMemo(
    () => identityVerdict(compareDeviceIdentity(result.case_a, result.case_b, platform)),
    [result.case_a, result.case_b, platform]
  );
  const pkgs = packageInventoryStatus(result);
  const signals = signalSectionDeltas(result).filter((d) => d.entityType !== "bundle");
  const changedSignals = signals.filter((d) => d.changed > 0);
  const tone =
    verdict.sameDevice === true && verdict.differentUpload === true
      ? "same-upload-diff"
      : verdict.sameDevice === false
        ? "diff-device"
        : verdict.sameDevice === true
          ? "same-device"
          : "unknown";

  return (
    <section className={`case-compare-focus case-compare-focus--${tone}`}>
      <div className="case-compare-focus__head">
        <div>
          <p className="case-compare-focus__eyebrow">{t("caseCompare.focusEyebrow")}</p>
          <h3 className="case-compare-focus__verdict">{verdict.label}</h3>
        </div>
        <p className="case-compare-focus__summary muted text-sm">
          {pkgs.identical
            ? t("caseCompare.packagesIdentical", { count: pkgs.shared })
            : t("caseCompare.packagesChanged", {
                added: pkgs.onlyB,
                removed: pkgs.onlyA,
                shared: pkgs.shared,
              })}
        </p>
      </div>
      <div className="case-compare-focus__cards">
        <div
          className={`case-compare-focus__card${pkgs.identical ? " case-compare-focus__card--ok" : " case-compare-focus__card--delta"}`}
        >
          <span className="case-compare-focus__card-label">{t("caseCompare.newPackages")}</span>
          <strong className="case-compare-focus__card-value">
            {pkgs.identical ? t("caseCompare.identical") : `+${pkgs.onlyB} / −${pkgs.onlyA}`}
          </strong>
          <span className="case-compare-focus__card-hint muted">
            {pkgs.identical
              ? t("caseCompare.packagesInventoryHint")
              : t("caseCompare.packagesHint")}
          </span>
        </div>
        {changedSignals.length === 0 ? (
          <div className="case-compare-focus__card case-compare-focus__card--ok">
            <span className="case-compare-focus__card-label">{t("caseCompare.externalDevices")}</span>
            <strong className="case-compare-focus__card-value">{t("caseCompare.identical")}</strong>
            <span className="case-compare-focus__card-hint muted">
              {t("caseCompare.noExternalDiff")}
            </span>
          </div>
        ) : (
          changedSignals.map((d) => (
            <div key={d.entityType} className="case-compare-focus__card case-compare-focus__card--delta">
              <span className="case-compare-focus__card-label">{d.label}</span>
              <strong className="case-compare-focus__card-value">
                +{d.onlyB} / −{d.onlyA}
              </strong>
              <span className="case-compare-focus__card-hint muted">
                {d.shared > 0
                  ? t("caseCompare.sharedCount", { count: d.shared })
                  : t("caseCompare.newOnly")}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ComparisonResults({
  result,
  tab,
  onTabChange,
}: {
  result: CaseComparisonResult;
  tab: CompareTab;
  onTabChange: (tab: CompareTab) => void;
}) {
  const { t } = useLocale();
  const [entityFilter, setEntityFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>(
    () => preferredDiffSection(result) ?? "all"
  );
  const [showProcesses, setShowProcesses] = useState(false);

  useEffect(() => {
    setSectionFilter(preferredDiffSection(result) ?? "all");
    setShowProcesses(false);
    setEntityFilter("");
  }, [result]);

  const scopeA = `source="${result.case_a.ingest_source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const scopeB = `source="${result.case_b.ingest_source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const scope = tab === "only_b" ? scopeB : scopeA;
  const caseALabel = result.case_a.title;
  const caseBLabel = result.case_b.title;

  const sectionsWithItems = useMemo(() => {
    return result.sections
      .map((section) => {
        const count =
          tab === "only_a"
            ? section.only_a.length
            : tab === "only_b"
              ? section.only_b.length
              : section.shared.length;
        return { section, count };
      })
      .filter(({ count }) => count > 0)
      .filter(
        ({ section }) =>
          isCompareSignalType(section.entity_type) ||
          (showProcesses && section.entity_type === "process")
      );
  }, [result.sections, tab, showProcesses]);

  const filteredSections = useMemo(() => {
    if (sectionFilter === "all") return sectionsWithItems;
    return sectionsWithItems.filter(({ section }) => section.entity_type === sectionFilter);
  }, [sectionsWithItems, sectionFilter]);

  const tabCounts: Record<CompareTab, number> = useMemo(() => {
    let only_b = 0;
    let only_a = 0;
    let shared = 0;
    for (const s of result.sections) {
      const include =
        isCompareSignalType(s.entity_type) || (showProcesses && s.entity_type === "process");
      if (!include) continue;
      only_b += s.only_b.length;
      only_a += s.only_a.length;
      shared += s.shared.length;
    }
    return { only_b, only_a, shared };
  }, [result.sections, showProcesses]);

  const preferred = preferredDiffSection(result);

  return (
    <section className="card case-compare-results">
      <div className="case-compare-results__versus">
        <CaseSideSummary side="A" meta={result.case_a} tone="baseline" />
        <div className="case-compare-results__versus-mid" aria-hidden>
          <GitCompare size={18} />
        </div>
        <CaseSideSummary side="B" meta={result.case_b} tone="compare" />
      </div>

      <ChangeFocusPanel result={result} />

      <details className="case-compare-identity-details">
        <summary>{t("caseCompare.identityTitle")}</summary>
        <DeviceIdentityPanel result={result} />
      </details>

      <div className="case-compare-results__controls">
        <div className="case-compare-segmented" role="tablist" aria-label="Comparison view">
          {(Object.keys(TAB_META) as CompareTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              disabled={tabCounts[id] === 0}
              className={`case-compare-segmented__btn case-compare-segmented__btn--${TAB_META[id].tone}${tab === id ? " case-compare-segmented__btn--active" : ""}`}
              onClick={() => onTabChange(id)}
            >
              <span>{TAB_META[id].label}</span>
              <span className="case-compare-segmented__count">{tabCounts[id]}</span>
            </button>
          ))}
        </div>
        <label className="case-compare-telemetry-toggle">
          <input
            type="checkbox"
            checked={showProcesses}
            onChange={(e) => setShowProcesses(e.target.checked)}
          />
          <span>{t("caseCompare.showProcesses")}</span>
        </label>
      </div>

      <p className="case-compare-results__hint muted text-xs">{TAB_META[tab].hint}</p>

      {tabCounts[tab] === 0 ? (
        <p className="muted text-sm case-compare-results__empty">{t("caseCompare.emptyDiff")}</p>
      ) : (
        <>
          <div className="case-compare-results__toolbar">
            <div className="case-compare-results__search">
              <Search size={14} aria-hidden />
              <Input
                type="search"
                placeholder={t("caseCompare.entityFilterPlaceholder")}
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                className="case-compare-results__search-input"
              />
            </div>
            {sectionsWithItems.length > 1 && (
              <div className="case-compare-section-chips" role="tablist" aria-label="Entity type">
                <button
                  type="button"
                  className={`case-compare-section-chip${sectionFilter === "all" ? " case-compare-section-chip--active" : ""}`}
                  onClick={() => setSectionFilter("all")}
                >
                  {t("caseCompare.allSections")} ({tabCounts[tab]})
                </button>
                {sectionsWithItems.map(({ section, count }) => (
                  <button
                    key={section.entity_type}
                    type="button"
                    className={`case-compare-section-chip${sectionFilter === section.entity_type ? " case-compare-section-chip--active" : ""}${section.entity_type === preferred ? " case-compare-section-chip--preferred" : ""}`}
                    onClick={() => setSectionFilter(section.entity_type)}
                  >
                    {section.label} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="case-compare-results__sections">
            {filteredSections.length === 0 ? (
              <p className="muted text-sm">{t("caseCompare.emptyDiff")}</p>
            ) : (
              filteredSections.map(({ section }) => (
                <EntitySectionBlock
                  key={section.entity_type}
                  section={section}
                  tab={tab}
                  scope={scope}
                  caseALabel={caseALabel}
                  caseBLabel={caseBLabel}
                  entityFilter={entityFilter}
                  defaultOpen={
                    section.entity_type === preferred ||
                    (preferred == null && isCompareSignalType(section.entity_type))
                  }
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}


export default function CaseComparisonPage() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const [searchParams, setSearchParams] = useSearchParams();
  const syncingUrl = useRef(false);
  const autoCompareKey = useRef<string | null>(
    (() => {
      const initial = parseCompareSearchParams(searchParams);
      return initial.caseAId && initial.caseBId
        ? `${initial.platform}:${initial.caseAId}:${initial.caseBId}`
        : null;
    })()
  );

  const [platform, setPlatform] = useState<ComparePlatform>(
    () => parseCompareSearchParams(searchParams).platform
  );
  const [cases, setCases] = useState<EligibleCase[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [caseAId, setCaseAId] = useState(
    () => parseCompareSearchParams(searchParams).caseAId
  );
  const [caseBId, setCaseBId] = useState(
    () => parseCompareSearchParams(searchParams).caseBId
  );
  const [caseFilter, setCaseFilter] = useState("");
  const [result, setResult] = useState<CaseComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<CompareTab>("only_b");
  const [copiedLink, setCopiedLink] = useState(false);

  const platformLabel = platform === "ios" ? "iOS" : "Android";
  const canCompare = Boolean(caseAId && caseBId && caseAId !== caseBId);
  const comparisonPath = canCompare
    ? comparePagePath({ platform, caseAId, caseBId })
    : "";

  const syncUrl = useCallback(
    (next: { platform: ComparePlatform; caseAId: string; caseBId: string }) => {
      syncingUrl.current = true;
      setSearchParams(buildCompareSearchParams(next), { replace: true });
      queueMicrotask(() => {
        syncingUrl.current = false;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    syncUrl({ platform, caseAId, caseBId });
  }, [platform, caseAId, caseBId, syncUrl]);

  useEffect(() => {
    if (syncingUrl.current) return;
    const parsed = parseCompareSearchParams(searchParams);
    setPlatform(parsed.platform);
    setCaseAId(parsed.caseAId);
    setCaseBId(parsed.caseBId);
  }, [searchParams]);

  const loadCases = useCallback(async () => {
    setLoadingCases(true);
    setError("");
    try {
      const list = await fetchEligibleComparisonCases(platform);
      setCases(list);
    } catch (e) {
      setCases([]);
      setError(String(e));
    } finally {
      setLoadingCases(false);
    }
  }, [platform]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  const selectPlatform = (next: ComparePlatform) => {
    if (next === platform) return;
    setPlatform(next);
    setCaseAId("");
    setCaseBId("");
    setCaseFilter("");
    setResult(null);
    setError("");
    autoCompareKey.current = null;
  };

  const filteredCases = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    return cases.filter((c) => matchesCaseFilter(c, q));
  }, [cases, caseFilter]);

  const swapCases = () => {
    setCaseAId(caseBId);
    setCaseBId(caseAId);
    setResult(null);
    autoCompareKey.current = null;
  };

  const runCompare = useCallback(async () => {
    if (!caseAId || !caseBId) {
      setError("Select two cases to compare.");
      return;
    }
    setComparing(true);
    setError("");
    setResult(null);
    log("info", "Case comparison", `${platform}: ${caseAId} vs ${caseBId}`);
    try {
      const data = await compareCases(platform, caseAId, caseBId);
      setResult(data);
      const preferred = preferredDiffSection(data);
      const preferredSection = preferred
        ? data.sections.find((s) => s.entity_type === preferred)
        : null;
      if (preferredSection && preferredSection.only_b.length > 0) setTab("only_b");
      else if (preferredSection && preferredSection.only_a.length > 0) setTab("only_a");
      else if (data.summary.only_b_count > 0) setTab("only_b");
      else setTab("shared");
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  }, [caseAId, caseBId, log, platform]);

  useEffect(() => {
    const key = autoCompareKey.current;
    if (!key || loadingCases || comparing) return;
    if (`${platform}:${caseAId}:${caseBId}` !== key) return;
    autoCompareKey.current = null;
    void runCompare();
  }, [loadingCases, comparing, platform, caseAId, caseBId, runCompare]);

  const copyComparisonLink = async () => {
    if (!canCompare) return;
    const url = comparePageUrl({ platform, caseAId, caseBId });
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setError(t("common.copyFailed"));
    }
  };

  return (
    <div className="case-compare-page">
      <PageHeader
        title={t("caseCompare.title")}
        description={t("caseCompare.subtitle")}
      />

      <section className="card case-compare-setup">
        <div
          className="case-compare-platform"
          role="tablist"
          aria-label={t("caseCompare.platformLabel")}
        >
          {(["android", "ios"] as ComparePlatform[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={platform === id}
              className={`case-compare-platform__btn${platform === id ? " case-compare-platform__btn--active" : ""}`}
              onClick={() => selectPlatform(id)}
            >
              <CasePlatformIcon platform={id} size={16} />
              <span>{id === "ios" ? "iOS" : "Android"}</span>
            </button>
          ))}
        </div>

        <SectionHeader
          label={t("caseCompare.selectCases")}
          meta={
            loadingCases
              ? "Loading…"
              : `${cases.length} ${platformLabel} case${cases.length === 1 ? "" : "s"}`
          }
        />
        {cases.length === 0 && !loadingCases && (
          <p className="muted text-sm">
            {platform === "ios"
              ? t("caseCompare.emptyIos")
              : t("caseCompare.emptyAndroid")}{" "}
            <Link to="/ingest">{t("caseCompare.ingestLink")}</Link>
          </p>
        )}
        {cases.length > 0 && (
          <div className="case-compare-setup__filter">
            <Search size={14} aria-hidden />
            <Input
              type="search"
              placeholder={t("caseCompare.filterPlaceholder")}
              value={caseFilter}
              onChange={(e) => setCaseFilter(e.target.value)}
              className="case-compare-setup__filter-input"
            />
          </div>
        )}
        <div className="case-compare-pickers">
          <CasePicker
            label={t("caseCompare.baseline")}
            cases={filteredCases}
            value={caseAId}
            onChange={(id) => {
              setCaseAId(id);
              setResult(null);
              autoCompareKey.current = null;
            }}
            excludeId={caseBId}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="case-compare-swap"
            title="Swap cases"
            onClick={swapCases}
            disabled={!caseAId && !caseBId}
          >
            <ArrowLeftRight size={16} />
          </Button>
          <CasePicker
            label={t("caseCompare.compare")}
            cases={filteredCases}
            value={caseBId}
            onChange={(id) => {
              setCaseBId(id);
              setResult(null);
              autoCompareKey.current = null;
            }}
            excludeId={caseAId}
          />
        </div>
        <div className="case-compare-actions">
          <Button
            type="button"
            disabled={comparing || !canCompare}
            onClick={() => void runCompare()}
          >
            {comparing ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {t("caseCompare.comparing")}
              </>
            ) : (
              <>
                <GitCompare size={14} aria-hidden />
                {t("caseCompare.runCompare")}
              </>
            )}
          </Button>
          {canCompare && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copyComparisonLink()}
              title={comparisonPath}
            >
              {copiedLink ? (
                <>
                  <Check size={14} aria-hidden />
                  {t("caseCompare.linkCopied")}
                </>
              ) : (
                <>
                  <Link2 size={14} aria-hidden />
                  {t("caseCompare.copyLink")}
                </>
              )}
            </Button>
          )}
        </div>
        {canCompare && (
          <p className="case-compare-share muted text-xs mono" title={comparisonPath}>
            {comparisonPath}
          </p>
        )}
        {error && <p className="error text-sm case-compare-error">{error}</p>}
      </section>

      {result && (
        <ComparisonResults result={result} tab={tab} onTabChange={setTab} />
      )}
    </div>
  );
}
