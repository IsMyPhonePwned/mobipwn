import { useEffect, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import type {
  IngestParserProgress,
  IngestProgressStep,
  LogarchiveDecodeProgress,
} from "@/lib/ingestProgress";

type Props = {
  visible: boolean;
  title: string;
  percent: number;
  phaseLabel: string;
  detail?: string;
  stage?: string;
  parsers?: IngestParserProgress[];
  parsersCompleted?: number;
  parsersTotal?: number;
  parsersActive?: string[];
  logarchive?: LogarchiveDecodeProgress | null;
  steps?: IngestProgressStep[];
};

function formatElapsed(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "";
  if (ms < 1000) return `${Math.max(0, Math.floor(ms))} ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem.toString().padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${(min % 60).toString().padStart(2, "0")}m`;
}

function LogarchiveDebug({ la }: { la: LogarchiveDecodeProgress }) {
  const { t } = useLocale();
  const maxLabel =
    la.max_lines == null
      ? "—"
      : la.max_lines === 0 || la.uncapped
        ? t("ingest.logarchiveUnlimited")
        : la.max_lines.toLocaleString();
  const decoded =
    la.events_decoded != null ? la.events_decoded.toLocaleString() : "—";
  const elapsed = formatElapsed(la.elapsed_ms);
  const fileShort = la.current_file
    ? la.current_file.length > 48
      ? `…${la.current_file.slice(-48)}`
      : la.current_file
    : null;

  return (
    <div className="ingest-progress__logarchive" role="status">
      <div className="ingest-progress__logarchive-head">
        <span className="ingest-progress__logarchive-title">
          {t("ingest.logarchiveDebugTitle")}
        </span>
        <span
          className={`ingest-progress__logarchive-phase ingest-progress__logarchive-phase--${la.phase || "unknown"}`}
        >
          {la.phase || "…"}
        </span>
      </div>
      {la.detail ? (
        <p className="ingest-progress__logarchive-detail mono">{la.detail}</p>
      ) : null}
      <dl className="ingest-progress__logarchive-stats">
        <div>
          <dt>{t("ingest.logarchiveEvents")}</dt>
          <dd className="mono">
            {decoded}
            <span className="muted"> / {maxLabel}</span>
          </dd>
        </div>
        {la.files_materialized != null ? (
          <div>
            <dt>{t("ingest.logarchiveFiles")}</dt>
            <dd className="mono">{la.files_materialized.toLocaleString()}</dd>
          </div>
        ) : null}
        {la.tracev3_files != null ? (
          <div>
            <dt>{t("ingest.logarchiveTracev3")}</dt>
            <dd className="mono">{la.tracev3_files.toLocaleString()}</dd>
          </div>
        ) : null}
        {elapsed ? (
          <div>
            <dt>{t("ingest.logarchiveElapsed")}</dt>
            <dd className="mono">{elapsed}</dd>
          </div>
        ) : null}
      </dl>
      {fileShort ? (
        <p className="ingest-progress__logarchive-file mono muted" title={la.current_file ?? undefined}>
          {t("ingest.logarchiveCurrentFile")}: {fileShort}
        </p>
      ) : null}
      {(la.phase === "decoding" || la.phase === "materializing" || la.phase === "starting") && (
        <p className="ingest-progress__logarchive-hint muted">{t("ingest.logarchiveSlowHint")}</p>
      )}
    </div>
  );
}

export function IngestProgressPanel({
  visible,
  title,
  percent,
  phaseLabel,
  detail,
  stage,
  parsers,
  parsersCompleted,
  parsersTotal,
  parsersActive,
  logarchive,
  steps,
}: Props) {
  const { t } = useLocale();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) {
      setStartedAt(null);
      return;
    }
    setStartedAt((prev) => prev ?? Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const clamped = Math.min(100, Math.max(0, percent));
  const isQueued = stage === "queued" || stage === "waiting";
  const isBusy =
    !isQueued &&
    (stage === "parsing" ||
      stage === "logarchive" ||
      stage === "opening" ||
      stage === "anonymizing" ||
      stage === "inserting" ||
      stage === "verifying" ||
      stage === "syncing" ||
      clamped > 0);
  const indeterminate = isQueued || (clamped > 0 && clamped < 5);
  const showLogarchive = Boolean(logarchive) || stage === "logarchive";
  const elapsedLabel =
    startedAt != null ? formatElapsed(now - startedAt) : "";
  const sortedParsers = parsers?.length
    ? [...parsers].sort((a, b) => {
        const rank = (p: IngestParserProgress) =>
          p.name === "logarchive" ? 0 : p.status === "running" ? 1 : 2;
        return rank(a) - rank(b);
      })
    : undefined;

  const rootClass = [
    "ingest-progress",
    isQueued ? "ingest-progress--queued" : "",
    isBusy ? "ingest-progress--busy" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} role="status" aria-live="polite">
      <div className="ingest-progress__header">
        <div className="ingest-progress__title-row">
          <span className="ingest-progress__pulse" aria-hidden />
          <span className="ingest-progress__title">{title}</span>
          {isQueued ? (
            <span className="ingest-progress__badge ingest-progress__badge--queue">
              {t("ingest.queueBadge")}
            </span>
          ) : null}
        </div>
        <div className="ingest-progress__header-meta">
          {elapsedLabel ? (
            <span className="ingest-progress__elapsed mono muted" title={t("ingest.elapsed")}>
              {elapsedLabel}
            </span>
          ) : null}
          <span className="ingest-progress__pct mono">
            {indeterminate ? "…" : `${clamped}%`}
          </span>
        </div>
      </div>
      <div
        className={`ingest-progress__bar${indeterminate ? " ingest-progress__bar--indeterminate" : ""}`}
        aria-hidden
      >
        <div
          className={`ingest-progress__fill${indeterminate ? " ingest-progress__fill--indeterminate" : ""}`}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      <p className="ingest-progress__phase">{phaseLabel}</p>
      {isQueued ? (
        <p className="ingest-progress__detail muted">{t("ingest.queuedHint")}</p>
      ) : null}
      {parsersActive && parsersActive.length > 0 && stage === "parsing" ? (
        <p className="ingest-progress__detail mono muted">
          Active: {parsersActive.slice(0, 6).join(", ")}
          {parsersActive.length > 6 ? ` (+${parsersActive.length - 6} more)` : ""}
        </p>
      ) : null}
      {parsersTotal != null && parsersTotal > 0 && (stage === "parsing" || stage === "logarchive") ? (
        <p className="ingest-progress__detail mono muted">
          {parsersCompleted ?? 0} / {parsersTotal} parsers finished
        </p>
      ) : null}
      {detail ? <p className="ingest-progress__detail mono muted">{detail}</p> : null}
      {showLogarchive && logarchive ? <LogarchiveDebug la={logarchive} /> : null}
      {sortedParsers && sortedParsers.length > 0 ? (
        <ul className="ingest-progress__parsers" aria-label="Parser results">
          {sortedParsers.map((parser) => {
            const running = parser.status === "running";
            const failed = parser.status === "failed" || (!parser.ok && !running);
            const statusClass = running ? "running" : failed ? "fail" : "ok";
            const isLogarchive = parser.name === "logarchive";
            return (
              <li
                key={`${parser.name}-${parser.status ?? "done"}`}
                className={`ingest-progress__parser ingest-progress__parser--${statusClass}${isLogarchive ? " ingest-progress__parser--logarchive" : ""}`}
              >
                <span className="ingest-progress__parser-name">{parser.name}</span>
                <span className="ingest-progress__parser-meta mono muted">
                  {running
                    ? isLogarchive
                      ? t("ingest.logarchiveParserRunning")
                      : "running…"
                    : failed
                      ? "failed"
                      : `${parser.events} records`}
                  {!running && parser.duration_ms > 0
                    ? ` · ${Math.round(parser.duration_ms)} ms`
                    : ""}
                </span>
                {parser.error ? (
                  <span className="ingest-progress__parser-error muted">{parser.error}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {stage === "parsing" ? (
        <p className="ingest-progress__hint muted">{t("ingest.parsingHint")}</p>
      ) : null}
      {stage === "logarchive" ? (
        <p className="ingest-progress__hint muted">{t("ingest.logarchiveHint")}</p>
      ) : null}
      {steps && steps.length > 0 ? (
        <ol className="ingest-progress__steps">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`ingest-progress__step ingest-progress__step--${step.status}`}
            >
              <span className="ingest-progress__step-dot" aria-hidden />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
