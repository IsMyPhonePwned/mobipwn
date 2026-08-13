import { useMemo, useState, useTransition } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_CRASH_TRACES_PANEL_ID, type CasePlatform } from "@/lib/caseDashboard";
import {
  androidCrashDetail,
  androidCrashKey,
  androidRecentFrames,
  backtraceFrames,
  caseCrashAdvancedHref,
  classifyCrashRow,
  crashIncidents,
  crashKindBadgeClass,
  crashKindLabel,
  crashSearchQuery,
  crashTracesQuery,
  formatCrashTimestamp,
  iosCrashDetail,
  iosCrashKey,
  iosRecentFrames,
  shortDataType,
  strField,
  summarizeCrashRows,
  symbolSearchQuery,
  topCrashSymbols,
  type CrashRow,
} from "@/lib/crashTraces";

const CRASH_INCIDENTS_PAGE = 20;

export function CaseCrashTracesPanel({
  ingestSource,
  refreshKey,
  platform = "android",
}: {
  ingestSource: string;
  refreshKey: number;
  platform?: CasePlatform;
}) {
  const { id: caseId = "" } = useParams();
  const isIos = platform === "ios";
  const [filter, setFilter] = useState("");
  const [listLimit, setListLimit] = useState(CRASH_INCIDENTS_PAGE);
  const [, startFilterTransition] = useTransition();
  const advancedHref = caseId ? caseCrashAdvancedHref(caseId) : "";
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_CRASH_TRACES_PANEL_ID,
      title: "Crashes & backtraces",
      query: crashTracesQuery(ingestSource, platform),
      viz: "table",
      layout: { i: CASE_CRASH_TRACES_PANEL_ID, x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
    }),
    [ingestSource, platform]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  const summary = useMemo(() => summarizeCrashRows(rows), [rows]);
  const incidents = useMemo(() => crashIncidents(rows), [rows]);
  const symbols = useMemo(() => topCrashSymbols(rows, 8), [rows]);
  const frames = useMemo(() => backtraceFrames(rows, 16), [rows]);
  const iosFrames = useMemo(() => (isIos ? iosRecentFrames(rows, 20) : []), [rows, isIos]);
  const androidFrames = useMemo(
    () => (!isIos ? androidRecentFrames(rows, 20) : []),
    [rows, isIos]
  );
  const filteredIncidents = useMemo(
    () => incidents.filter((row) => crashIncidentMatchesFilter(row, filter, isIos)),
    [incidents, filter, isIos]
  );
  const visibleIncidents = useMemo(
    () => filteredIncidents.slice(0, listLimit),
    [filteredIncidents, listLimit]
  );
  const visibleSymbols = useMemo(
    () =>
      symbols.filter((s) => panelSearchMatch(filter, s.process, s.function, s.bundle, s.count)),
    [symbols, filter]
  );
  const visibleFrames = useMemo(
    () =>
      frames.filter((row) =>
        panelSearchMatch(
          filter,
          strField(row, "function"),
          strField(row, "process_name"),
          strField(row, "bundle_id"),
          formatCrashTimestamp(strField(row, "timestamp"))
        )
      ),
    [frames, filter]
  );
  const visibleIosFrames = useMemo(
    () =>
      iosFrames.filter(({ frame, process }) =>
        panelSearchMatch(filter, frame.symbol, frame.image, frame.address, frame.imageOffset, process)
      ),
    [iosFrames, filter]
  );
  const visibleAndroidFrames = useMemo(
    () =>
      androidFrames.filter(({ frame, process }) =>
        panelSearchMatch(
          filter,
          frame.function,
          frame.library,
          frame.pc,
          frame.method,
          process
        )
      ),
    [androidFrames, filter]
  );

  if (loading && rows.length === 0) {
    return (
      <div className="case-crash-panel case-crash-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-crash-panel case-crash-panel--error muted text-xs">{error}</p>;
  }

  if (!rows.length) {
    return (
      <p className="case-crash-panel case-crash-panel--empty muted text-xs">
        {isIos
          ? "No crashlogs (.ips) events for this case yet."
          : "No crash, ANR, or backtrace events for this case yet."}
      </p>
    );
  }

  return (
    <div
      className={isIos ? "case-crash-panel--ios case-crash-panel" : "case-crash-panel"}
    >
      {advancedHref && (
        <div className="case-crash-panel__advanced">
          <Link to={advancedHref} className="case-crash-panel__advanced-link text-xs">
            <ExternalLink size={12} aria-hidden />
            Advanced crash explorer
          </Link>
          <span className="muted text-xs">
            {isIos
              ? "All threads, images, and raw .ips fields"
              : "Tombstone backtraces, ANR threads, and full ext"}
          </span>
        </div>
      )}
      <CasePanelSearchBar
        value={filter}
        onChange={(next) => {
          setFilter(next);
          startFilterTransition(() => setListLimit(CRASH_INCIDENTS_PAGE));
        }}
        placeholder={
          isIos
            ? "Filter process, exception, signal, pid, image, or symbol…"
            : "Filter process, signal, ANR, abort, symbol, or library…"
        }
      />
      <div className="case-crash-panel__summary">
        {summary.tombstone > 0 && (
          <span className="case-crash-stat case-crash-stat--tombstone">
            <AlertTriangle size={14} aria-hidden />
            {summary.tombstone} native
          </span>
        )}
        {summary.anr > 0 && (
          <span className="case-crash-stat case-crash-stat--anr">
            <Bug size={14} aria-hidden />
            {summary.anr} ANR
          </span>
        )}
        {summary.backtrace > 0 && (
          <span className="case-crash-stat case-crash-stat--backtrace">
            <Code2 size={14} aria-hidden />
            {summary.backtrace} frames
          </span>
        )}
        {summary.crash > 0 && (
          <span className={`case-crash-stat${isIos ? " case-crash-stat--crash" : " muted"}`}>
            {summary.crash} {isIos ? "crash report" : "other"}
            {isIos && summary.crash !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="case-crash-panel__scroll">
        {visibleIncidents.length > 0 && (
          <section className="case-crash-section">
            <h4 className="case-crash-section__title">
              {isIos ? "Crash reports (.ips)" : "Incidents"}
              {filteredIncidents.length > 0 && (
                <span className="muted">
                  {" "}
                  · {visibleIncidents.length}
                  {filteredIncidents.length > visibleIncidents.length
                    ? ` / ${filteredIncidents.length}`
                    : ` of ${filteredIncidents.length}`}
                </span>
              )}
            </h4>
            <ul className="case-crash-incidents">
              {visibleIncidents.map((row, i) =>
                isIos ? (
                  <IosCrashIncident
                    key={iosCrashKey(row) || `inc-ios-${i}`}
                    row={row}
                    scope={scope}
                    platform={platform}
                    caseId={caseId}
                  />
                ) : (
                  <AndroidCrashIncident
                    key={androidCrashKey(row) || `inc-android-${i}`}
                    row={row}
                    allRows={rows}
                    scope={scope}
                    platform={platform}
                    caseId={caseId}
                  />
                )
              )}
            </ul>
            {filteredIncidents.length > visibleIncidents.length && (
              <div className="case-crash-panel__more">
                <button
                  type="button"
                  className="case-crash-panel__more-btn"
                  onClick={() =>
                    setListLimit((n) =>
                      Math.min(n + CRASH_INCIDENTS_PAGE, filteredIncidents.length)
                    )
                  }
                >
                  Show more ({visibleIncidents.length} / {filteredIncidents.length})
                </button>
              </div>
            )}
          </section>
        )}

        {visibleSymbols.length > 0 && (
          <section className="case-crash-section">
            <h4 className="case-crash-section__title">Top symbols</h4>
            <div className="case-crash-symbols-wrap">
              <table className="case-crash-symbols">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Symbol</th>
                    <th>#</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleSymbols.map((s) => (
                    <tr key={`${s.process}-${s.function}`}>
                      <td className="mono">{s.process}</td>
                      <td className="mono case-crash-symbols__fn" title={s.function}>
                        {s.function}
                      </td>
                      <td className="mono">{s.count}</td>
                      <td>
                        <Link
                          to={buildSearchHref(symbolSearchQuery(s, scope, platform), { run: true })}
                          className="text-xs"
                        >
                          Hunt
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {isIos && visibleIosFrames.length > 0 && (
          <section className="case-crash-section">
            <h4 className="case-crash-section__title">Faulting-thread frames</h4>
            <ul className="case-crash-frames">
              {visibleIosFrames.map(({ row, frame, process }, i) => (
                <li key={`ios-frame-${i}`} className="case-crash-frame">
                  <span className="case-crash-frame__idx mono muted text-xs">
                    #{frame.index}
                  </span>
                  <code className="case-crash-frame__fn">{frame.symbol}</code>
                  <span className="case-crash-frame__meta muted text-xs">
                    {frame.image && <span className="mono">{frame.image}</span>}
                    {frame.image && process && " · "}
                    {process && <span className="mono">{process}</span>}
                  </span>
                  <Link
                    to={buildSearchHref(crashSearchQuery(row, scope, platform), { run: true })}
                    className="case-crash-frame__link text-xs"
                  >
                    Pivot
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!isIos && visibleAndroidFrames.length > 0 && (
          <section className="case-crash-section">
            <h4 className="case-crash-section__title">Recent backtrace frames</h4>
            <ul className="case-crash-frames">
              {visibleAndroidFrames.map(({ row, frame, process }, i) => (
                <li key={`android-frame-${i}`} className="case-crash-frame">
                  <span className="case-crash-frame__idx mono muted text-xs">
                    #{frame.index}
                  </span>
                  <code className="case-crash-frame__fn">
                    {frame.function || frame.method || "—"}
                  </code>
                  <span className="case-crash-frame__meta muted text-xs">
                    {frame.library && <span className="mono">{frame.library}</span>}
                    {frame.library && process && " · "}
                    {process && <span className="mono">{process}</span>}
                    {frame.offset ? ` +${frame.offset}` : ""}
                  </span>
                  <Link
                    to={buildSearchHref(crashSearchQuery(row, scope, platform), { run: true })}
                    className="case-crash-frame__link text-xs"
                  >
                    Pivot
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!isIos && visibleAndroidFrames.length === 0 && visibleFrames.length > 0 && (
          <section className="case-crash-section">
            <h4 className="case-crash-section__title">Recent backtrace frames</h4>
            <ul className="case-crash-frames">
              {visibleFrames.map((row, i) => {
                const fn = strField(row, "function");
                const process = strField(row, "process_name") || strField(row, "bundle_id");
                const ts = formatCrashTimestamp(strField(row, "timestamp"));
                return (
                  <li key={`frame-${i}`} className="case-crash-frame">
                    <code className="case-crash-frame__fn">{fn}</code>
                    <span className="case-crash-frame__meta muted text-xs">
                      {process && <span className="mono">{process}</span>}
                      {process && ts && " · "}
                      {ts}
                    </span>
                    <Link
                      to={buildSearchHref(crashSearchQuery(row, scope, platform), { run: true })}
                      className="case-crash-frame__link text-xs"
                    >
                      Pivot
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {visibleIncidents.length === 0 &&
          visibleSymbols.length === 0 &&
          visibleIosFrames.length === 0 &&
          visibleAndroidFrames.length === 0 &&
          visibleFrames.length === 0 && (
            <p className="muted text-xs">No crash content matches “{filter.trim()}”.</p>
          )}
      </div>
    </div>
  );
}

function crashIncidentMatchesFilter(row: CrashRow, filter: string, isIos: boolean): boolean {
  if (!isIos) {
    const detail = androidCrashDetail(row);
    return panelSearchMatch(
      filter,
      classifyCrashRow(row),
      detail.process,
      detail.signal,
      detail.code,
      detail.abortMessage,
      detail.pid,
      detail.tid,
      detail.threadName,
      detail.filename,
      detail.subject,
      detail.cmdline,
      strField(row, "process_name"),
      strField(row, "bundle_id"),
      strField(row, "action"),
      strField(row, "message"),
      strField(row, "data_type")
    );
  }
  const detail = iosCrashDetail(row);
  return panelSearchMatch(
    filter,
    detail.process,
    detail.bundle,
    detail.exceptionType,
    detail.exceptionCodes,
    detail.signal,
    detail.termination,
    detail.reason,
    detail.pid,
    detail.osVersion,
    detail.appVersion,
    detail.crashFile,
    detail.threadName,
    detail.threadQueue,
    detail.ipsFormat,
    strField(row, "message")
  );
}

function AndroidCrashIncident({
  row,
  allRows,
  scope,
  platform,
  caseId,
}: {
  row: CrashRow;
  allRows: CrashRow[];
  scope: string;
  platform: CasePlatform;
  caseId: string;
}) {
  const [open, setOpen] = useState(false);
  const kind = classifyCrashRow(row);
  const detail = androidCrashDetail(row, allRows);
  const ts = formatCrashTimestamp(strField(row, "timestamp"));
  const message = strField(row, "message");
  const dt = shortDataType(strField(row, "data_type"));
  const advancedHref = caseId ? caseCrashAdvancedHref(caseId, androidCrashKey(row)) : "";
  const chips = [
    detail.pid ? `pid ${detail.pid}` : "",
    detail.tid ? `tid ${detail.tid}` : "",
    detail.signal,
    detail.code,
    detail.threadName,
    detail.abi,
    detail.frameCount > 0 ? `${detail.frameCount} frames` : "",
    detail.threadsTotal > 0 ? `${detail.threadsTotal} threads` : "",
    detail.filename,
  ].filter(Boolean);

  return (
    <li className={`case-crash-incident case-crash-incident--android${open ? " is-open" : ""}`}>
      <div className="case-crash-incident__head">
        <button
          type="button"
          className="case-crash-incident__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide detail" : "Show detail"}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </button>
        <span className={`badge ${crashKindBadgeClass(kind)}`}>{crashKindLabel(kind)}</span>
        <strong className="case-crash-incident__process mono">{detail.process}</strong>
        {ts && <span className="muted text-xs">{ts}</span>}
        {advancedHref && (
          <Link to={advancedHref} className="case-crash-incident__link text-xs">
            Advanced
          </Link>
        )}
        <Link
          to={buildSearchHref(crashSearchQuery(row, scope, platform), { run: true })}
          className="case-crash-incident__link text-xs"
        >
          Search
        </Link>
      </div>

      <div className="case-crash-incident__meta muted text-xs">
        {chips.map((c, i) => (
          <span key={`${c}-${i}`} className="case-crash-chip mono">
            {c}
          </span>
        ))}
        {dt && <span className="case-crash-chip">{dt}</span>}
        {strField(row, "severity") === "high" && (
          <span className="case-crash-kind case-crash-kind--tombstone">high</span>
        )}
      </div>

      {detail.abortMessage && (
        <p className="case-crash-incident__reason muted text-xs">{detail.abortMessage}</p>
      )}
      {detail.subject && detail.subject !== detail.abortMessage && (
        <p className="case-crash-incident__reason muted text-xs">{detail.subject}</p>
      )}
      {message &&
        !message.startsWith(`Native crash (tombstone): ${detail.process}`) &&
        !message.startsWith("ANR ") && (
          <p className="case-crash-incident__message">{message}</p>
        )}

      {open && (
        <div className="case-crash-incident__detail">
          {(detail.signal ||
            detail.code ||
            detail.faultAddr ||
            detail.pid ||
            detail.tid ||
            detail.uid ||
            detail.cmdline ||
            detail.abi ||
            detail.buildFingerprint ||
            detail.filename ||
            detail.owner) && (
            <dl className="case-crash-kv">
              {detail.signal && (
                <>
                  <dt>Signal</dt>
                  <dd className="mono">{detail.signal}</dd>
                </>
              )}
              {detail.code && (
                <>
                  <dt>Code</dt>
                  <dd className="mono">{detail.code}</dd>
                </>
              )}
              {detail.faultAddr && (
                <>
                  <dt>Fault addr</dt>
                  <dd className="mono">{detail.faultAddr}</dd>
                </>
              )}
              {detail.pid && (
                <>
                  <dt>PID</dt>
                  <dd className="mono">{detail.pid}</dd>
                </>
              )}
              {detail.tid && (
                <>
                  <dt>TID</dt>
                  <dd className="mono">{detail.tid}</dd>
                </>
              )}
              {detail.uid && (
                <>
                  <dt>UID</dt>
                  <dd className="mono">{detail.uid}</dd>
                </>
              )}
              {detail.threadName && (
                <>
                  <dt>Thread</dt>
                  <dd className="mono">{detail.threadName}</dd>
                </>
              )}
              {detail.cmdline && (
                <>
                  <dt>Cmdline</dt>
                  <dd className="mono">{detail.cmdline}</dd>
                </>
              )}
              {detail.abi && (
                <>
                  <dt>ABI</dt>
                  <dd className="mono">{detail.abi}</dd>
                </>
              )}
              {detail.buildFingerprint && (
                <>
                  <dt>Build</dt>
                  <dd className="mono">{detail.buildFingerprint}</dd>
                </>
              )}
              {detail.filename && (
                <>
                  <dt>File</dt>
                  <dd className="mono">{detail.filename}</dd>
                </>
              )}
              {detail.owner && (
                <>
                  <dt>Owner</dt>
                  <dd className="mono">
                    {detail.owner}
                    {detail.group ? `:${detail.group}` : ""}
                    {detail.size ? ` · ${detail.size} B` : ""}
                  </dd>
                </>
              )}
            </dl>
          )}

          {detail.frames.length > 0 && (
            <div className="case-crash-stack">
              <h5 className="case-crash-stack__title">
                {kind === "anr" ? "Thread stack (first)" : "Native backtrace"}
              </h5>
              <ol className="case-crash-stack__list">
                {detail.frames.slice(0, 12).map((fr) => (
                  <li key={`${fr.index}-${fr.pc}-${fr.function}`} className="case-crash-stack__frame">
                    <span className="case-crash-stack__idx mono">{fr.index}</span>
                    <code className="case-crash-stack__sym">
                      {fr.function || fr.method || "—"}
                    </code>
                    <span className="case-crash-stack__img muted text-xs mono">
                      {fr.library}
                      {fr.offset ? ` +${fr.offset}` : ""}
                      {fr.pc ? ` @ ${fr.pc}` : ""}
                      {fr.fileLoc
                        ? ` ${fr.fileLoc}${fr.lineNumber ? `:${fr.lineNumber}` : ""}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ol>
              {detail.frames.length > 12 && (
                <p className="muted text-xs">
                  +{detail.frames.length - 12} more frames in Advanced explorer
                </p>
              )}
            </div>
          )}

          {!detail.frames.length && !detail.abortMessage && !detail.signal && (
            <p className="muted text-xs">
              No nested backtrace on this event. Open Advanced explorer for full ext, or re-ingest
              after the latest Crash parser.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function IosCrashIncident({
  row,
  scope,
  platform,
  caseId,
}: {
  row: CrashRow;
  scope: string;
  platform: CasePlatform;
  caseId: string;
}) {
  const [open, setOpen] = useState(false);
  const detail = iosCrashDetail(row);
  const ts = formatCrashTimestamp(strField(row, "timestamp"));
  const message = strField(row, "message");
  const advancedHref = caseId
    ? caseCrashAdvancedHref(caseId, iosCrashKey(row))
    : "";
  const chips = [
    detail.pid ? `pid ${detail.pid}` : "",
    detail.exceptionType,
    detail.signal,
    detail.ipsFormat,
    detail.threadName || (detail.faultingThread !== "" ? `thread ${detail.faultingThread}` : ""),
    detail.threadsTotal > 0 ? `${detail.threadsTotal} threads` : "",
    detail.frameCount > 0 ? `${detail.frameCount} frames` : "",
  ].filter(Boolean);

  return (
    <li className={`case-crash-incident case-crash-incident--ios${open ? " is-open" : ""}`}>
      <div className="case-crash-incident__head">
        <button
          type="button"
          className="case-crash-incident__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide stack" : "Show stack"}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </button>
        <span className={`badge ${crashKindBadgeClass("crash")}`}>Crash</span>
        <strong className="case-crash-incident__process mono">{detail.process}</strong>
        {ts && <span className="muted text-xs">{ts}</span>}
        {advancedHref && (
          <Link to={advancedHref} className="case-crash-incident__link text-xs">
            Advanced
          </Link>
        )}
        <Link
          to={buildSearchHref(crashSearchQuery(row, scope, platform), { run: true })}
          className="case-crash-incident__link text-xs"
        >
          Search
        </Link>
      </div>

      <div className="case-crash-incident__meta muted text-xs">
        {chips.map((c, i) => (
          <span key={`${c}-${i}`} className="case-crash-chip mono">
            {c}
          </span>
        ))}
        {detail.bundle && detail.bundle !== detail.process && (
          <span className="case-crash-chip mono">{detail.bundle}</span>
        )}
      </div>

      {detail.reason && (
        <p className="case-crash-incident__reason muted text-xs">{detail.reason}</p>
      )}
      {message &&
        message !== `Crashlog: ${detail.process}` &&
        message !== `Crashlog: ${detail.reason}` && (
          <p className="case-crash-incident__message">{message}</p>
        )}
      {detail.crashFile && (
        <p className="case-crash-incident__file muted text-xs mono" title={detail.crashPath}>
          {detail.crashFile}
        </p>
      )}

      {open && (
        <div className="case-crash-incident__detail">
          {(detail.exceptionType ||
            detail.exceptionCodes ||
            detail.signal ||
            detail.termination ||
            detail.pid ||
            detail.appVersion ||
            detail.osVersion ||
            detail.threadName ||
            detail.threadQueue ||
            detail.faultingThread !== "" ||
            detail.ipsFormat) && (
            <dl className="case-crash-kv">
              {detail.exceptionType && (
                <>
                  <dt>Exception</dt>
                  <dd className="mono">{detail.exceptionType}</dd>
                </>
              )}
              {detail.exceptionCodes && (
                <>
                  <dt>Codes</dt>
                  <dd className="mono">{detail.exceptionCodes}</dd>
                </>
              )}
              {detail.signal && (
                <>
                  <dt>Signal</dt>
                  <dd className="mono">{detail.signal}</dd>
                </>
              )}
              {detail.termination && (
                <>
                  <dt>Termination</dt>
                  <dd className="mono">{detail.termination}</dd>
                </>
              )}
              {detail.pid && (
                <>
                  <dt>PID</dt>
                  <dd className="mono">{detail.pid}</dd>
                </>
              )}
              {detail.appVersion && (
                <>
                  <dt>App version</dt>
                  <dd className="mono">{detail.appVersion}</dd>
                </>
              )}
              {detail.osVersion && (
                <>
                  <dt>OS</dt>
                  <dd className="mono">{detail.osVersion}</dd>
                </>
              )}
              {(detail.threadName || detail.threadQueue || detail.faultingThread !== "") && (
                <>
                  <dt>Faulting thread</dt>
                  <dd className="mono">
                    {[
                      detail.faultingThread !== "" ? `#${detail.faultingThread}` : "",
                      detail.threadName,
                      detail.threadQueue ? `queue=${detail.threadQueue}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </>
              )}
              {detail.ipsFormat && (
                <>
                  <dt>Format</dt>
                  <dd className="mono">{detail.ipsFormat}</dd>
                </>
              )}
            </dl>
          )}

          {detail.asi && (
            <div className="case-crash-asi">
              <h5 className="case-crash-stack__title">Application Specific Information</h5>
              <pre className="case-crash-asi__body mono">{detail.asi}</pre>
            </div>
          )}

          {detail.frames.length > 0 && (
            <div className="case-crash-stack">
              <h5 className="case-crash-stack__title">Faulting thread</h5>
              <ol className="case-crash-stack__list">
                {detail.frames.map((fr) => (
                  <li key={fr.index} className="case-crash-stack__frame">
                    <span className="case-crash-stack__idx mono">{fr.index}</span>
                    <code className="case-crash-stack__sym">{fr.symbol}</code>
                    <span className="case-crash-stack__img muted text-xs mono">
                      {fr.image}
                      {fr.imageOffset ? ` + ${fr.imageOffset}` : ""}
                      {fr.address ? ` @ ${fr.address}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {detail.lastExceptionFrames.length > 0 && (
            <div className="case-crash-stack">
              <h5 className="case-crash-stack__title">Last exception backtrace</h5>
              <ol className="case-crash-stack__list">
                {detail.lastExceptionFrames.map((fr) => (
                  <li key={`leb-${fr.index}`} className="case-crash-stack__frame">
                    <span className="case-crash-stack__idx mono">{fr.index}</span>
                    <code className="case-crash-stack__sym">{fr.symbol}</code>
                    <span className="case-crash-stack__img muted text-xs mono">
                      {fr.image}
                      {fr.imageOffset ? ` + ${fr.imageOffset}` : ""}
                      {fr.address ? ` @ ${fr.address}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {detail.images.length > 0 && (
            <div className="case-crash-images">
              <h5 className="case-crash-stack__title">Binary images</h5>
              <ul className="case-crash-images__list">
                {detail.images.map((img) => (
                  <li key={`${img.name}-${img.uuid}`} className="case-crash-images__item mono text-xs">
                    <span>{img.name}</span>
                    {img.arch && <span className="muted"> {img.arch}</span>}
                    {img.uuid && (
                      <span className="muted case-crash-images__uuid" title={img.uuid}>
                        {" "}
                        {img.uuid.slice(0, 8)}…
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!detail.frames.length &&
            !detail.lastExceptionFrames.length &&
            !detail.images.length &&
            !detail.asi && (
              <p className="muted text-xs">
                No structured threads in this event (summary-only or legacy text). Re-ingest after the
                latest sysdiagnose crashlogs parser for full stacks.
              </p>
            )}
        </div>
      )}
    </li>
  );
}
