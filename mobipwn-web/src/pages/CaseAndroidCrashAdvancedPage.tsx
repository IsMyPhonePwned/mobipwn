import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { CASE_CRASH_TRACES_PANEL_ID } from "@/lib/caseDashboard";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import {
  androidCrashAdvancedDetail,
  androidCrashKey,
  caseCrashAdvancedHref,
  crashIncidents,
  crashKindBadgeClass,
  crashKindLabel,
  crashSearchQuery,
  crashTracesQuery,
  formatCrashTimestamp,
  type AndroidCrashAdvancedDetail,
  type AndroidCrashFrame,
  type AndroidCrashThread,
  type CrashRow,
  type IosCrashField,
} from "@/lib/crashTraces";

export default function CaseAndroidCrashAdvancedPage({
  caseId,
  caseTitle,
  ingestSource,
}: {
  caseId: string;
  caseTitle: string;
  ingestSource: string;
}) {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState("");
  const selectedKey = searchParams.get("crash") || "";

  const panel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_CRASH_TRACES_PANEL_ID}_advanced_android`,
      title: "Android crash advanced",
      query: ingestSource ? crashTracesQuery(ingestSource, "android", { head: 400 }) : "",
      viz: "table",
      layout: { i: "adv-android", x: 0, y: 0, w: 12, h: 8, minW: 6, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", 0, Boolean(ingestSource));
  const scope = ingestSource ? `source="${escapeMplString(ingestSource)}"` : "";
  const incidents = useMemo(() => crashIncidents(rows), [rows]);

  const filtered = useMemo(() => {
    return incidents.filter((row) => {
      const d = androidCrashAdvancedDetail(row, rows);
      return panelSearchMatch(
        filter,
        d.process,
        d.signal,
        d.code,
        d.abortMessage,
        d.pid,
        d.tid,
        d.threadName,
        d.filename,
        d.subject,
        d.cmdline,
        d.abi,
        d.message,
        crashKindLabel(d.kind)
      );
    });
  }, [incidents, filter, rows]);

  const selectedRow = useMemo(() => {
    if (!filtered.length) return null;
    if (selectedKey) {
      const match = filtered.find((row) => androidCrashKey(row) === selectedKey);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedKey]);

  const detail = useMemo(
    () => (selectedRow ? androidCrashAdvancedDetail(selectedRow, rows) : null),
    [selectedRow, rows]
  );

  useEffect(() => {
    if (!selectedRow) return;
    const key = androidCrashKey(selectedRow);
    if (key && key !== selectedKey) {
      setSearchParams({ crash: key }, { replace: true });
    }
  }, [selectedRow, selectedKey, setSearchParams]);

  return (
    <div className="case-crash-adv case-crash-adv--android">
      <PageHeader
        title={t("cases.crashAdvancedAndroidTitle")}
        meta={
          <span className="muted">
            <Link to="/cases/search">{t("nav.cases")}</Link>
            {" / "}
            <Link to={`/cases/${encodeURIComponent(caseId)}`}>{caseTitle || caseId}</Link>
            {" / "}
            {t("cases.crashAdvancedCrumb")}
          </span>
        }
        description={t("cases.crashAdvancedAndroidDesc")}
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
                <Link to={buildSearchHref(`${scope} parser="Crash"`, { run: true })}>
                  <Search size={14} aria-hidden />
                  {t("cases.crashAdvancedAndroidSearch")}
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
              {t("cases.crashAdvancedAndroidListTitle", { count: filtered.length })}
            </h2>
            <CasePanelSearchBar
              value={filter}
              onChange={setFilter}
              placeholder={t("cases.crashAdvancedAndroidFilter")}
            />
          </div>
          {loading && incidents.length === 0 ? (
            <p className="muted text-xs case-crash-adv__empty">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t("common.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="muted text-xs case-crash-adv__empty">
              {t("cases.crashAdvancedAndroidEmpty")}
            </p>
          ) : (
            <ul className="case-crash-adv__items">
              {filtered.map((row) => {
                const d = androidCrashAdvancedDetail(row, rows);
                const active = detail?.key === d.key;
                return (
                  <li key={d.key}>
                    <button
                      type="button"
                      className={`case-crash-adv__item${active ? " is-active" : ""}`}
                      onClick={() => setSearchParams({ crash: d.key })}
                    >
                      <span className="case-crash-adv__item-badges">
                        <span className={`badge ${crashKindBadgeClass(d.kind)}`}>
                          {crashKindLabel(d.kind)}
                        </span>
                      </span>
                      <strong className="mono">{d.process}</strong>
                      <span className="muted text-xs">
                        {formatCrashTimestamp(d.timestamp) || "—"}
                        {d.signal ? ` · ${d.signal}` : ""}
                        {d.subject ? ` · ${d.subject}` : ""}
                      </span>
                      {d.filename && <span className="mono text-xs muted">{d.filename}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="case-crash-adv__detail card">
          {!detail || !selectedRow ? (
            <p className="muted text-xs case-crash-adv__empty">
              {t("cases.crashAdvancedAndroidPick")}
            </p>
          ) : (
            <AndroidCrashAdvancedDetailView
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

function AndroidCrashAdvancedDetailView({
  detail,
  row,
  scope,
  caseId,
}: {
  detail: AndroidCrashAdvancedDetail;
  row: CrashRow;
  scope: string;
  caseId: string;
}) {
  const { t } = useLocale();
  const [openThreadId, setOpenThreadId] = useState<string | null>(
    detail.threads[0]?.id ?? null
  );
  const [showExt, setShowExt] = useState(false);

  useEffect(() => {
    setOpenThreadId(detail.threads[0]?.id ?? null);
    setShowExt(false);
  }, [detail.key]);

  return (
    <div className="case-crash-adv-detail">
      <header className="case-crash-adv-detail__hero">
        <div>
          <div className="case-crash-adv-detail__badges">
            <span className={`badge ${crashKindBadgeClass(detail.kind)}`}>
              {crashKindLabel(detail.kind)}
            </span>
          </div>
          <h2 className="case-crash-adv-detail__process mono">{detail.process}</h2>
          <p className="muted text-xs case-crash-adv-detail__sub">
            {formatCrashTimestamp(detail.timestamp)}
            {detail.pid ? ` · pid ${detail.pid}` : ""}
            {detail.tid ? ` · tid ${detail.tid}` : ""}
            {detail.uid ? ` · uid ${detail.uid}` : ""}
          </p>
        </div>
        <div className="case-crash-adv-detail__hero-actions">
          <Link
            to={buildSearchHref(crashSearchQuery(row, scope, "android"), { run: true })}
            className="text-xs"
          >
            {t("cases.crashAdvancedPivot")}
          </Link>
          <Link to={caseCrashAdvancedHref(caseId, detail.key)} className="text-xs muted">
            {t("cases.crashAdvancedPermalink")}
          </Link>
        </div>
      </header>

      {(detail.abortMessage || detail.subject || detail.message) && (
        <p className="case-crash-adv-detail__reason">
          {detail.abortMessage || detail.subject || detail.message}
        </p>
      )}

      <section className="case-crash-adv-section">
        <h3 className="case-crash-adv-section__title">{t("cases.crashAdvancedOverview")}</h3>
        <dl className="case-crash-kv case-crash-adv-kv">
          {kv("Signal", detail.signal)}
          {kv("Code", detail.code)}
          {kv("Fault address", detail.faultAddr)}
          {kv("Abort message", detail.abortMessage)}
          {kv("Thread", detail.threadName)}
          {kv("Cmdline", detail.cmdline)}
          {kv("ABI", detail.abi)}
          {kv("Build fingerprint", detail.buildFingerprint)}
          {kv("Filename", detail.filename)}
          {kv("Subject", detail.subject)}
          {kv("Size", detail.size)}
          {kv("Owner", detail.owner ? `${detail.owner}${detail.group ? `:${detail.group}` : ""}` : "")}
          {kv("Permissions", detail.permissions)}
          {kv(
            "Threads",
            detail.threadsTotal ? String(detail.threadsTotal) : String(detail.threads.length || "")
          )}
          {kv("Frames", detail.frameCount ? String(detail.frameCount) : "")}
        </dl>
      </section>

      {detail.threads.length > 0 && (
        <section className="case-crash-adv-section">
          <h3 className="case-crash-adv-section__title">
            <Layers size={14} aria-hidden />
            {detail.kind === "tombstone"
              ? t("cases.crashAdvancedAndroidBacktrace", { count: detail.frames.length })
              : t("cases.crashAdvancedThreads", { count: detail.threads.length })}
          </h3>
          <ul className="case-crash-adv-threads">
            {detail.threads.map((th) => (
              <AndroidThreadBlock
                key={th.id}
                thread={th}
                open={openThreadId === th.id}
                onToggle={() => setOpenThreadId((cur) => (cur === th.id ? null : th.id))}
                native={detail.kind === "tombstone"}
              />
            ))}
          </ul>
        </section>
      )}

      {(detail.processInfoFields.length > 0 ||
        detail.headerFields.length > 0 ||
        detail.metadataFields.length > 0) && (
        <section className="case-crash-adv-section">
          <h3 className="case-crash-adv-section__title">
            {t("cases.crashAdvancedMetadata")}
          </h3>
          <div className="case-crash-adv-fields-grid">
            {detail.headerFields.length > 0 && (
              <FieldTable title="header" fields={detail.headerFields} />
            )}
            {detail.processInfoFields.length > 0 && (
              <FieldTable title="process_info" fields={detail.processInfoFields} />
            )}
            {detail.metadataFields.length > 0 && (
              <FieldTable title="ext" fields={detail.metadataFields} />
            )}
          </div>
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

      {!detail.threads.length && !detail.extJson && (
        <p className="muted text-xs">{t("cases.crashAdvancedAndroidNoStructure")}</p>
      )}
    </div>
  );
}

function AndroidThreadBlock({
  thread,
  open,
  onToggle,
  native,
}: {
  thread: AndroidCrashThread;
  open: boolean;
  onToggle: () => void;
  native: boolean;
}) {
  const label = [
    thread.tid ? `tid ${thread.tid}` : "",
    thread.name,
    thread.status,
    thread.priority ? `prio ${thread.priority}` : "",
    thread.isDaemon ? "daemon" : "",
    `${thread.frameCount || thread.frames.length} frames`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="case-crash-adv-thread">
      <button type="button" className="case-crash-adv-thread__head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="mono text-xs">{label}</span>
      </button>
      {open &&
        (thread.frames.length ? (
          <AndroidFrameTable frames={thread.frames} native={native} />
        ) : (
          <p className="muted text-xs">No frames</p>
        ))}
    </li>
  );
}

function AndroidFrameTable({
  frames,
  native,
}: {
  frames: AndroidCrashFrame[];
  native: boolean;
}) {
  if (native) {
    return (
      <div className="case-crash-adv-table-wrap">
        <table className="case-crash-adv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Function</th>
              <th>Library</th>
              <th>Offset</th>
              <th>PC</th>
              <th>Build ID</th>
            </tr>
          </thead>
          <tbody>
            {frames.map((fr) => (
              <tr key={`${fr.index}-${fr.pc}-${fr.function}`}>
                <td className="mono muted">{fr.index}</td>
                <td className="mono" title={fr.rawLine || undefined}>
                  {fr.function || "—"}
                </td>
                <td className="mono muted">{fr.library || "—"}</td>
                <td className="mono muted">{fr.offset || "—"}</td>
                <td className="mono muted">{fr.pc || "—"}</td>
                <td className="mono muted" title={fr.buildId || undefined}>
                  {fr.buildId ? `${fr.buildId.slice(0, 12)}…` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="case-crash-adv-table-wrap">
      <table className="case-crash-adv-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Method / details</th>
            <th>File</th>
            <th>Library</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((fr) => (
            <tr key={`${fr.index}-${fr.method}-${fr.address}`}>
              <td className="mono muted">{fr.index}</td>
              <td className="mono muted">{fr.frameType || "—"}</td>
              <td className="mono">{fr.method || fr.details || fr.function || "—"}</td>
              <td className="mono muted">
                {fr.fileLoc}
                {fr.lineNumber ? `:${fr.lineNumber}` : ""}
                {!fr.fileLoc && "—"}
              </td>
              <td className="mono muted">{fr.library || "—"}</td>
              <td className="mono muted">{fr.address || "—"}</td>
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

function kv(label: string, value: string) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
    </>
  );
}
