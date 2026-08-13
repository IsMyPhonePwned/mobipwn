import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  Layers,
  Loader2,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { useLocale } from "@/contexts/LocaleContext";
import { apiFetch } from "@/lib/api";
import { fetchCase } from "@/lib/cases";
import { inferCasePlatform, CASE_CRASH_TRACES_PANEL_ID } from "@/lib/caseDashboard";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import {
  caseCrashAdvancedHref,
  crashIncidents,
  crashSearchQuery,
  crashTracesQuery,
  formatCrashTimestamp,
  iosCrashAdvancedDetail,
  iosCrashKey,
  type CrashRow,
  type IosCrashAdvancedDetail,
  type IosCrashField,
  type IosCrashFrame,
  type IosCrashThread,
} from "@/lib/crashTraces";

const CaseAndroidCrashAdvancedPage = lazy(() => import("./CaseAndroidCrashAdvancedPage"));

export default function CaseCrashAdvancedPage() {
  const { id = "" } = useParams();
  const { t } = useLocale();
  const [caseTitle, setCaseTitle] = useState("");
  const [ingestSource, setIngestSource] = useState("");
  const [platform, setPlatform] = useState<"android" | "ios" | "endpoint" | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingCase, setLoadingCase] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadingCase(true);
    setLoadError("");
    void fetchCase(id)
      .then(async (c) => {
        if (cancelled) return;
        setCaseTitle(c.title);
        const source = c.ingest_source || c.title;
        setIngestSource(source);
        let jobs: Array<{ platform?: string | null }> = [];
        if (source) {
          try {
            jobs = await apiFetch(`/v1/ingest/jobs?source=${encodeURIComponent(source)}&limit=20`);
          } catch {
            jobs = [];
          }
        }
        if (!cancelled) setPlatform(inferCasePlatform(c, jobs));
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingCase(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadingCase) {
    return (
      <p className="muted case-crash-adv__loading">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        {t("common.loading")}
      </p>
    );
  }

  if (loadError || !ingestSource) {
    return <p className="error">{loadError || t("cases.crashAdvancedNotFound")}</p>;
  }

  if (platform === "android") {
    return (
      <Suspense
        fallback={
          <p className="muted case-crash-adv__loading">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            {t("common.loading")}
          </p>
        }
      >
        <CaseAndroidCrashAdvancedPage
          caseId={id}
          caseTitle={caseTitle}
          ingestSource={ingestSource}
        />
      </Suspense>
    );
  }

  if (platform && platform !== "ios") {
    return (
      <p className="muted text-sm">
        {t("cases.crashAdvancedUnsupported")}{" "}
        <Link to={`/cases/${encodeURIComponent(id)}`}>{t("cases.crashAdvancedBack")}</Link>
      </p>
    );
  }

  return (
    <IosCrashAdvancedExplorer
      caseId={id}
      caseTitle={caseTitle}
      ingestSource={ingestSource}
    />
  );
}

function IosCrashAdvancedExplorer({
  caseId,
  caseTitle,
  ingestSource,
}: {
  caseId: string;
  caseTitle: string;
  ingestSource: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLocale();
  const [filter, setFilter] = useState("");
  const selectedKey = searchParams.get("crash") || "";

  const panel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_CRASH_TRACES_PANEL_ID}_advanced`,
      title: "iOS crash advanced",
      query: crashTracesQuery(ingestSource, "ios", { head: 200 }),
      viz: "table",
      layout: { i: "adv", x: 0, y: 0, w: 12, h: 8, minW: 6, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", 0, Boolean(ingestSource));
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const incidents = useMemo(() => crashIncidents(rows), [rows]);

  const filtered = useMemo(() => {
    return incidents.filter((row) => {
      const d = iosCrashAdvancedDetail(row);
      return panelSearchMatch(
        filter,
        d.process,
        d.bundle,
        d.exceptionType,
        d.signal,
        d.reason,
        d.pid,
        d.crashFile,
        d.crashPath,
        d.osVersion,
        d.appVersion,
        d.message
      );
    });
  }, [incidents, filter]);

  const selectedRow = useMemo(() => {
    if (!filtered.length) return null;
    if (selectedKey) {
      const match = filtered.find((row) => iosCrashKey(row) === selectedKey);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedKey]);

  const detail = useMemo(
    () => (selectedRow ? iosCrashAdvancedDetail(selectedRow) : null),
    [selectedRow]
  );

  useEffect(() => {
    if (!selectedRow) return;
    const key = iosCrashKey(selectedRow);
    if (key && key !== selectedKey) {
      setSearchParams({ crash: key }, { replace: true });
    }
  }, [selectedRow, selectedKey, setSearchParams]);

  return (
    <div className="case-crash-adv">
      <PageHeader
        title={t("cases.crashAdvancedTitle")}
        meta={
          <span className="muted">
            <Link to="/cases/search">{t("nav.cases")}</Link>
            {" / "}
            <Link to={`/cases/${encodeURIComponent(caseId)}`}>{caseTitle || caseId}</Link>
            {" / "}
            {t("cases.crashAdvancedCrumb")}
          </span>
        }
        description={t("cases.crashAdvancedDesc")}
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/cases/${encodeURIComponent(caseId)}`}>
                <ArrowLeft size={14} aria-hidden />
                {t("cases.crashAdvancedBack")}
              </Link>
            </Button>
            {scope && (
              <Button variant="secondary" size="sm" asChild>
                <Link to={buildSearchHref(`${scope} parser="crashlogs"`, { run: true })}>
                  <Search size={14} aria-hidden />
                  {t("cases.crashAdvancedSearch")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {error && <p className="error text-xs">{error}</p>}

      <div className="case-crash-adv__layout">
        <aside className="case-crash-adv__list card">
          <div className="case-crash-adv__list-head">
            <h2 className="case-crash-adv__list-title">
              <AlertTriangle size={14} aria-hidden />
              {t("cases.crashAdvancedListTitle", { count: filtered.length })}
            </h2>
            <CasePanelSearchBar
              value={filter}
              onChange={setFilter}
              placeholder={t("cases.crashAdvancedFilter")}
            />
          </div>
          {loading && incidents.length === 0 ? (
            <p className="muted text-xs case-crash-adv__empty">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t("common.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="muted text-xs case-crash-adv__empty">{t("cases.crashAdvancedEmpty")}</p>
          ) : (
            <ul className="case-crash-adv__items">
              {filtered.map((row) => {
                const d = iosCrashAdvancedDetail(row);
                const active = detail?.key === d.key;
                return (
                  <li key={d.key}>
                    <button
                      type="button"
                      className={`case-crash-adv__item${active ? " is-active" : ""}`}
                      onClick={() => setSearchParams({ crash: d.key })}
                    >
                      <strong className="mono">{d.process}</strong>
                      <span className="case-crash-adv__item-meta muted text-xs">
                        {formatCrashTimestamp(d.timestamp) || "—"}
                      </span>
                      <span className="case-crash-adv__item-badges">
                        {d.signal && (
                          <span className="case-crash-adv-chip case-crash-adv-chip--danger mono">
                            {d.signal}
                          </span>
                        )}
                        {d.exceptionType && (
                          <span className="case-crash-adv-chip case-crash-adv-chip--warn mono">
                            {d.exceptionType}
                          </span>
                        )}
                        {d.threads.length > 0 && (
                          <span className="case-crash-adv-chip case-crash-adv-chip--muted mono">
                            {d.threads.length} thr
                          </span>
                        )}
                      </span>
                      {d.crashFile && (
                        <span className="mono text-xs muted case-crash-adv__item-file" title={d.crashFile}>
                          {d.crashFile}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="case-crash-adv__detail card">
          {!detail || !selectedRow ? (
            <p className="muted text-xs case-crash-adv__empty">{t("cases.crashAdvancedPick")}</p>
          ) : (
            <CrashAdvancedDetail
              detail={detail}
              row={selectedRow}
              scope={scope}
              caseId={caseId}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function CrashAdvancedDetail({
  detail,
  row,
  scope,
  caseId,
}: {
  detail: IosCrashAdvancedDetail;
  row: CrashRow;
  scope: string;
  caseId: string;
}) {
  const { t } = useLocale();
  type DetailTab = "summary" | "threads" | "images" | "data";
  const [tab, setTab] = useState<DetailTab>("summary");
  const [openThreadId, setOpenThreadId] = useState<string | null>(
    detail.threads.find((th) => th.triggered)?.id ?? detail.threads[0]?.id ?? null
  );
  const [threadFilter, setThreadFilter] = useState("");
  const [imageFilter, setImageFilter] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [showExt, setShowExt] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showExceptionFields, setShowExceptionFields] = useState(false);

  const faultingThread =
    detail.threads.find((th) => th.triggered) ||
    detail.threads.find((th) => String(th.id) === String(detail.faultingThread)) ||
    detail.threads[0] ||
    null;

  useEffect(() => {
    setTab("summary");
    setOpenThreadId(
      detail.threads.find((th) => th.triggered)?.id ?? detail.threads[0]?.id ?? null
    );
    setThreadFilter("");
    setImageFilter("");
    setShowRaw(false);
    setShowExt(false);
    setShowMeta(false);
    setShowExceptionFields(false);
  }, [detail.key]);

  const structureBits = [
    detail.structure?.threadsTruncated ? t("cases.crashAdvancedTruncThreads") : "",
    detail.structure?.framesTruncated ? t("cases.crashAdvancedTruncFrames") : "",
    detail.structure?.imagesTruncated ? t("cases.crashAdvancedTruncImages") : "",
  ].filter(Boolean);

  const heroChips = [
    detail.exceptionType ? { label: detail.exceptionType, tone: "danger" as const } : null,
    detail.signal ? { label: detail.signal, tone: "danger" as const } : null,
    detail.termination ? { label: detail.termination, tone: "warn" as const } : null,
    detail.faultingThread !== "" || detail.threadName
      ? {
          label: [
            detail.faultingThread !== "" ? `#${detail.faultingThread}` : "",
            detail.threadName,
          ]
            .filter(Boolean)
            .join(" "),
          tone: "neutral" as const,
        }
      : null,
    detail.threads.length
      ? { label: `${detail.threads.length} threads`, tone: "neutral" as const }
      : null,
    detail.images.length
      ? { label: `${detail.images.length} images`, tone: "neutral" as const }
      : null,
    detail.appVersion ? { label: `v${detail.appVersion}`, tone: "neutral" as const } : null,
    detail.ipsFormat ? { label: detail.ipsFormat, tone: "muted" as const } : null,
  ].filter(Boolean) as { label: string; tone: "danger" | "warn" | "neutral" | "muted" }[];

  const filteredThreads = useMemo(() => {
    const q = threadFilter.trim().toLowerCase();
    const list = [...detail.threads].sort((a, b) => {
      if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
      return Number(a.id) - Number(b.id);
    });
    if (!q) return list;
    return list.filter((th) =>
      [th.id, th.name, th.queue, th.triggered ? "faulting" : ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [detail.threads, threadFilter]);

  const filteredImages = useMemo(() => {
    const q = imageFilter.trim().toLowerCase();
    if (!q) return detail.images;
    return detail.images.filter((img) =>
      [img.name, img.uuid, img.arch, img.base, String(img.index)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [detail.images, imageFilter]);

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "summary", label: t("cases.crashAdvancedTabSummary") },
    {
      id: "threads",
      label: t("cases.crashAdvancedTabThreads"),
      count: detail.threads.length,
    },
    {
      id: "images",
      label: t("cases.crashAdvancedTabImages"),
      count: detail.images.length,
    },
    { id: "data", label: t("cases.crashAdvancedTabData") },
  ];

  return (
    <div className="case-crash-adv-detail case-crash-adv-detail--ios">
      <header className="case-crash-adv-detail__hero">
        <div className="case-crash-adv-detail__hero-main">
          <h2 className="case-crash-adv-detail__process mono">{detail.process}</h2>
          <p className="muted text-xs case-crash-adv-detail__sub">
            {formatCrashTimestamp(detail.timestamp)}
            {detail.bundle ? ` · ${detail.bundle}` : ""}
            {detail.pid ? ` · pid ${detail.pid}` : ""}
            {detail.osVersion ? ` · ${detail.osVersion}` : ""}
          </p>
          {heroChips.length > 0 && (
            <div className="case-crash-adv-chips" aria-label="Crash highlights">
              {heroChips.map((c) => (
                <span
                  key={`${c.tone}-${c.label}`}
                  className={`case-crash-adv-chip case-crash-adv-chip--${c.tone} mono`}
                  title={c.label}
                >
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="case-crash-adv-detail__hero-actions">
          <Link
            to={buildSearchHref(crashSearchQuery(row, scope, "ios"), { run: true })}
            className="text-xs"
          >
            {t("cases.crashAdvancedPivot")}
          </Link>
          <Link to={caseCrashAdvancedHref(caseId, detail.key)} className="text-xs muted">
            {t("cases.crashAdvancedPermalink")}
          </Link>
        </div>
      </header>

      {(detail.reason || detail.message) && (
        <p className="case-crash-adv-detail__reason">
          {detail.reason || detail.message}
        </p>
      )}

      {structureBits.length > 0 && (
        <p className="case-crash-adv-detail__trunc muted text-xs">
          {structureBits.join(" · ")}
        </p>
      )}

      {detail.crashFile && (
        <p className="case-crash-adv-detail__file muted text-xs mono" title={detail.crashPath}>
          {detail.crashFile}
        </p>
      )}

      <nav className="case-crash-adv-tabs" aria-label={t("cases.crashAdvancedTabsLabel")}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`case-crash-adv-tabs__btn${tab === item.id ? " is-active" : ""}`}
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
          >
            {item.label}
            {item.count != null && item.count > 0 ? (
              <span className="case-crash-adv-tabs__count mono">{item.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="case-crash-adv-detail__body">
        {tab === "summary" && (
          <div className="case-crash-adv-panel">
            <section className="case-crash-adv-section">
              <h3 className="case-crash-adv-section__title">
                {t("cases.crashAdvancedOverview")}
              </h3>
              <div className="case-crash-adv-factgrid">
                <Fact label="Exception" value={detail.exceptionType} emphasize />
                <Fact label="Signal" value={detail.signal} emphasize />
                <Fact label="Codes" value={detail.exceptionCodes} />
                <Fact label="Termination" value={detail.termination} />
                <Fact
                  label="Faulting thread"
                  value={
                    [
                      detail.faultingThread !== "" ? `#${detail.faultingThread}` : "",
                      detail.threadName,
                      detail.threadQueue ? `queue=${detail.threadQueue}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
                />
                <Fact label="App version" value={detail.appVersion} />
                <Fact label="OS" value={detail.osVersion} />
                <Fact label="Format" value={detail.ipsFormat} />
                <Fact
                  label="Threads"
                  value={
                    detail.threadsTotal
                      ? `${detail.threads.length} shown / ${detail.threadsTotal} total`
                      : String(detail.threads.length || "")
                  }
                />
                <Fact
                  label="Images"
                  value={
                    detail.structure?.imagesTotal
                      ? `${detail.images.length} shown / ${detail.structure.imagesTotal} total`
                      : String(detail.images.length || "")
                  }
                />
                <Fact label="Path" value={detail.crashPath} wide />
              </div>
            </section>

            {detail.asi && (
              <section className="case-crash-adv-section">
                <h3 className="case-crash-adv-section__title">ASI</h3>
                <pre className="case-crash-asi__body case-crash-adv-pre case-crash-adv-pre--compact mono">
                  {detail.asi}
                </pre>
              </section>
            )}

            {faultingThread && faultingThread.frames.length > 0 && (
              <section className="case-crash-adv-section">
                <div className="case-crash-adv-section__head">
                  <h3 className="case-crash-adv-section__title">
                    <Layers size={14} aria-hidden />
                    {t("cases.crashAdvancedFaultingStack")}
                  </h3>
                  <button
                    type="button"
                    className="case-crash-adv-linkish text-xs"
                    onClick={() => {
                      setTab("threads");
                      setOpenThreadId(faultingThread.id);
                    }}
                  >
                    {t("cases.crashAdvancedViewAllThreads")}
                  </button>
                </div>
                <p className="muted text-xs mono case-crash-adv-thread-label">
                  {[
                    `#${faultingThread.id}`,
                    faultingThread.name,
                    faultingThread.queue ? `queue=${faultingThread.queue}` : "",
                    `${faultingThread.frames.length} frames`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <FrameTable frames={faultingThread.frames} compact />
              </section>
            )}

            {detail.lastExceptionFrames.length > 0 && (
              <section className="case-crash-adv-section">
                <h3 className="case-crash-adv-section__title">
                  {t("cases.crashAdvancedLastException")}
                </h3>
                <FrameTable frames={detail.lastExceptionFrames} compact />
              </section>
            )}

            {!faultingThread?.frames.length &&
              !detail.lastExceptionFrames.length &&
              !detail.asi && (
                <p className="muted text-xs">{t("cases.crashAdvancedNoStructure")}</p>
              )}
          </div>
        )}

        {tab === "threads" && (
          <div className="case-crash-adv-panel">
            <div className="case-crash-adv-toolbar">
              <CasePanelSearchBar
                value={threadFilter}
                onChange={setThreadFilter}
                placeholder={t("cases.crashAdvancedThreadFilter")}
              />
              <span className="muted text-xs mono">
                {filteredThreads.length}/{detail.threads.length}
              </span>
            </div>
            {filteredThreads.length === 0 ? (
              <p className="muted text-xs">{t("cases.crashAdvancedThreadEmpty")}</p>
            ) : (
              <ul className="case-crash-adv-threads">
                {filteredThreads.map((th) => (
                  <ThreadBlock
                    key={th.id}
                    thread={th}
                    open={openThreadId === th.id}
                    onToggle={() =>
                      setOpenThreadId((cur) => (cur === th.id ? null : th.id))
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "images" && (
          <div className="case-crash-adv-panel">
            <div className="case-crash-adv-toolbar">
              <CasePanelSearchBar
                value={imageFilter}
                onChange={setImageFilter}
                placeholder={t("cases.crashAdvancedImageFilter")}
              />
              <span className="muted text-xs mono">
                {filteredImages.length}/{detail.images.length}
              </span>
            </div>
            {filteredImages.length === 0 ? (
              <p className="muted text-xs">{t("cases.crashAdvancedImageEmpty")}</p>
            ) : (
              <div className="case-crash-adv-table-wrap case-crash-adv-table-wrap--tall">
                <table className="case-crash-adv-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Arch</th>
                      <th>Base</th>
                      <th>UUID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredImages.map((img) => (
                      <tr key={`${img.index}-${img.uuid}-${img.name}`}>
                        <td className="mono muted">{img.index}</td>
                        <td className="mono" title={img.name}>
                          {basenamePath(img.name)}
                          {basenamePath(img.name) !== img.name && (
                            <span className="case-crash-adv-table__sub muted">{img.name}</span>
                          )}
                        </td>
                        <td className="mono muted">{img.arch || "—"}</td>
                        <td className="mono muted">{img.base || "—"}</td>
                        <td className="mono muted" title={img.uuid}>
                          {img.uuid ? (
                            <>
                              <span className="case-crash-adv-uuid-short">
                                {img.uuid.slice(0, 8)}
                              </span>
                              <span className="case-crash-adv-uuid-rest muted">
                                {img.uuid.slice(8)}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "data" && (
          <div className="case-crash-adv-panel">
            {(detail.exceptionFields.length > 0 || detail.terminationFields.length > 0) && (
              <section className="case-crash-adv-section">
                <button
                  type="button"
                  className="case-crash-adv-section__toggle"
                  onClick={() => setShowExceptionFields((v) => !v)}
                  aria-expanded={showExceptionFields}
                >
                  {showExceptionFields ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t("cases.crashAdvancedExceptionTerm")}
                  <span className="case-crash-adv-tabs__count mono">
                    {detail.exceptionFields.length + detail.terminationFields.length}
                  </span>
                </button>
                {showExceptionFields && (
                  <div className="case-crash-adv-fields-grid">
                    {detail.exceptionFields.length > 0 && (
                      <FieldTable title="exception" fields={detail.exceptionFields} />
                    )}
                    {detail.terminationFields.length > 0 && (
                      <FieldTable title="termination" fields={detail.terminationFields} />
                    )}
                  </div>
                )}
              </section>
            )}

            {(detail.reportFields.length > 0 || detail.headerFields.length > 0) && (
              <section className="case-crash-adv-section">
                <button
                  type="button"
                  className="case-crash-adv-section__toggle"
                  onClick={() => setShowMeta((v) => !v)}
                  aria-expanded={showMeta}
                >
                  {showMeta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t("cases.crashAdvancedMetadata")}
                  <span className="case-crash-adv-tabs__count mono">
                    {detail.reportFields.length + detail.headerFields.length}
                  </span>
                </button>
                {showMeta && (
                  <div className="case-crash-adv-fields-grid">
                    {detail.reportFields.length > 0 && (
                      <FieldTable title="report" fields={detail.reportFields} />
                    )}
                    {detail.headerFields.length > 0 && (
                      <FieldTable title="header / data" fields={detail.headerFields} />
                    )}
                  </div>
                )}
              </section>
            )}

            {detail.reportRaw && (
              <section className="case-crash-adv-section">
                <button
                  type="button"
                  className="case-crash-adv-section__toggle"
                  onClick={() => setShowRaw((v) => !v)}
                  aria-expanded={showRaw}
                >
                  {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Code2 size={14} aria-hidden />
                  {t("cases.crashAdvancedReportRaw")}
                </button>
                {showRaw && <pre className="case-crash-adv-pre mono">{detail.reportRaw}</pre>}
              </section>
            )}

            {detail.extJson && (
              <section className="case-crash-adv-section">
                <button
                  type="button"
                  className="case-crash-adv-section__toggle"
                  onClick={() => setShowExt((v) => !v)}
                  aria-expanded={showExt}
                >
                  {showExt ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Code2 size={14} aria-hidden />
                  {t("cases.crashAdvancedExtJson")}
                </button>
                {showExt && <pre className="case-crash-adv-pre mono">{detail.extJson}</pre>}
              </section>
            )}

            {!detail.exceptionFields.length &&
              !detail.terminationFields.length &&
              !detail.reportFields.length &&
              !detail.headerFields.length &&
              !detail.reportRaw &&
              !detail.extJson && (
                <p className="muted text-xs">{t("cases.crashAdvancedNoStructure")}</p>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function basenamePath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function Fact({
  label,
  value,
  emphasize,
  wide,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  wide?: boolean;
}) {
  if (!value) return null;
  return (
    <div
      className={`case-crash-adv-fact${emphasize ? " case-crash-adv-fact--em" : ""}${
        wide ? " case-crash-adv-fact--wide" : ""
      }`}
    >
      <span className="case-crash-adv-fact__label">{label}</span>
      <span className="case-crash-adv-fact__value mono" title={value}>
        {value}
      </span>
    </div>
  );
}

function ThreadBlock({
  thread,
  open,
  onToggle,
}: {
  thread: IosCrashThread;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`case-crash-adv-thread${thread.triggered ? " is-faulting" : ""}`}>
      <button type="button" className="case-crash-adv-thread__head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="case-crash-adv-thread__id mono">#{thread.id}</span>
        {thread.triggered && (
          <span className="case-crash-adv-chip case-crash-adv-chip--danger">faulting</span>
        )}
        <span className="case-crash-adv-thread__name mono text-xs">
          {thread.name || "—"}
        </span>
        {thread.queue && (
          <span className="case-crash-adv-thread__queue muted text-xs mono" title={thread.queue}>
            {thread.queue}
          </span>
        )}
        <span className="case-crash-adv-thread__frames muted text-xs mono">
          {thread.frameCount || thread.frames.length} frames
        </span>
      </button>
      {open &&
        (thread.frames.length ? (
          <FrameTable frames={thread.frames} compact />
        ) : (
          <p className="muted text-xs case-crash-adv-thread__empty">No frames</p>
        ))}
    </li>
  );
}

function FrameTable({
  frames,
  compact = false,
}: {
  frames: IosCrashFrame[];
  compact?: boolean;
}) {
  return (
    <div
      className={`case-crash-adv-table-wrap${compact ? " case-crash-adv-table-wrap--frames" : ""}`}
    >
      <table className="case-crash-adv-table case-crash-adv-table--frames">
        <thead>
          <tr>
            <th className="case-crash-adv-table__idx">#</th>
            <th>Frame</th>
            <th className="case-crash-adv-table__meta">Offset</th>
            <th className="case-crash-adv-table__meta">Address</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((fr) => (
            <tr key={fr.index}>
              <td className="mono muted case-crash-adv-table__idx">{fr.index}</td>
              <td className="case-crash-adv-frame-cell">
                <code className="case-crash-adv-frame-cell__sym" title={fr.symbol}>
                  {fr.symbol}
                  {fr.symbolLocation ? (
                    <span className="muted"> +{fr.symbolLocation}</span>
                  ) : null}
                </code>
                {(fr.image || fr.imageIndex) && (
                  <span className="case-crash-adv-frame-cell__img muted mono text-xs">
                    {fr.image || "—"}
                    {fr.imageIndex !== "" ? ` [${fr.imageIndex}]` : ""}
                  </span>
                )}
              </td>
              <td className="mono muted case-crash-adv-table__meta">
                {fr.imageOffset || "—"}
              </td>
              <td className="mono muted case-crash-adv-table__meta">{fr.address || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FieldTable({ title, fields }: { title: string; fields: IosCrashField[] }) {
  return (
    <div className="case-crash-adv-fields">
      <h4 className="case-crash-adv-fields__title mono">{title}</h4>
      <dl className="case-crash-kv case-crash-adv-kv">
        {fields.map((f) => (
          <div key={f.key} className="case-crash-adv-kv__row">
            <dt className="mono">{f.key}</dt>
            <dd className="mono">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
