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
  if (ms == null || ms <= 0) return "";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
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
  if (!visible) return null;

  const clamped = Math.min(100, Math.max(0, percent));
  const showLogarchive = Boolean(logarchive) || stage === "logarchive";
  const sortedParsers = parsers?.length
    ? [...parsers].sort((a, b) => {
        const rank = (p: IngestParserProgress) =>
          p.name === "logarchive" ? 0 : p.status === "running" ? 1 : 2;
        return rank(a) - rank(b);
      })
    : undefined;

  return (
    <div className="ingest-progress" role="status" aria-live="polite">
      <div className="ingest-progress__header">
        <span className="ingest-progress__title">{title}</span>
        <span className="ingest-progress__pct mono">{clamped}%</span>
      </div>
      <div className="ingest-progress__bar" aria-hidden>
        <div className="ingest-progress__fill" style={{ width: `${clamped}%` }} />
      </div>
      <p className="ingest-progress__phase">{phaseLabel}</p>
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
