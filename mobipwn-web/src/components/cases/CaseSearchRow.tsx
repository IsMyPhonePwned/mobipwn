import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Copy,
  Database,
  FolderSearch,
  Monitor,
  Radio,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { useLocale } from "@/contexts/LocaleContext";
import type { CaseRecord } from "@/lib/cases";
import {
  caseDescriptionSummary,
  caseFirstIngestAt,
  caseHasDistinctLastIngest,
  caseIngestSource,
  caseOriginQuickLink,
  caseWasReingested,
  displayCaseTags,
  inferCaseOrigin,
  inferCasePlatform,
  ORIGIN_LABELS,
  PLATFORM_LABELS,
  type CaseOrigin,
} from "@/lib/casePresentation";
import { formatRelativeCompact, formatWallTimestamp } from "@/lib/formatRelative";

type Props = {
  caseRec: CaseRecord;
  editingUser: { id: string; value: string } | null;
  onStartEditUser: (caseRec: CaseRecord) => void;
  onEditUserChange: (value: string) => void;
  onCancelEditUser: () => void;
  onSaveUser: (caseRec: CaseRecord, owner: string) => void | Promise<void>;
  onFilterOwner: (owner: string) => void;
  onFilterTag: (tag: string) => void;
  onCopySource: (source: string) => void;
  /** When set, show Delete with confirm; omit if the user cannot write cases. */
  onDelete?: (caseRec: CaseRecord) => void | Promise<void>;
  deleting?: boolean;
};

function OriginIcon({ origin, platform }: { origin: CaseOrigin; platform: ReturnType<typeof inferCasePlatform> }) {
  if (origin === "collector") return <Radio size={16} aria-hidden />;
  if (origin === "endpoint" || platform === "endpoint") return <Monitor size={16} aria-hidden />;
  if (platform === "ios" || platform === "android") {
    return <CasePlatformIcon platform={platform} size={16} />;
  }
  if (origin === "ingest") return <Upload size={16} aria-hidden />;
  return <FolderSearch size={16} aria-hidden />;
}

function caseStatusVariant(status: string): "new" | "triaged" | "resolved" | "default" {
  if (status === "open") return "new";
  if (status === "investigating") return "triaged";
  if (status === "closed") return "resolved";
  return "default";
}

function priorityClass(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "critical" || p === "high") return "badge-critical";
  if (p === "medium") return "badge-triaged";
  return "";
}

export function CaseSearchRow({
  caseRec,
  editingUser,
  onStartEditUser,
  onEditUserChange,
  onCancelEditUser,
  onSaveUser,
  onFilterOwner,
  onFilterTag,
  onCopySource,
  onDelete,
  deleting = false,
}: Props) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const origin = inferCaseOrigin(caseRec);
  const platform = inferCasePlatform(caseRec);
  const source = caseIngestSource(caseRec);
  const visibleTags = displayCaseTags(caseRec);
  const firstIngestIso = caseFirstIngestAt(caseRec);
  const created = formatRelativeCompact(firstIngestIso);
  const createdAbs = formatWallTimestamp(firstIngestIso);
  const lastIngestIso = caseRec.last_ingest_at?.trim() || "";
  const lastIngestRel = lastIngestIso ? formatRelativeCompact(lastIngestIso) : "";
  const lastIngestAbs = lastIngestIso ? formatWallTimestamp(lastIngestIso) : "";
  const reingested = caseWasReingested(caseRec);
  const ingestRuns = caseRec.ingest_run_count ?? 0;
  const showLastIngest = caseHasDistinctLastIngest(caseRec);
  const isEditingOwner = editingUser?.id === caseRec.id;
  const summary = caseDescriptionSummary(caseRec.description);
  const quickLink = caseOriginQuickLink(caseRec);
  const shortId = caseRec.id.slice(0, 8);
  const deviceModel = caseRec.device_model?.trim() || "";
  const osVersionRaw = caseRec.os_version?.trim() || "";
  const osVersion = osVersionRaw.startsWith("iPhone OS ")
    ? `iOS ${osVersionRaw.slice("iPhone OS ".length)}`
    : osVersionRaw;
  const deviceLabel = [deviceModel, osVersion].filter(Boolean).join(" · ");

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      onCopySource(source);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <article className={`case-search-row case-search-row--${origin}${reingested ? " case-search-row--reingested" : ""}`}>
      <div className={`case-search-row__icon case-search-row__icon--${platform ?? origin}`} aria-hidden>
        <OriginIcon origin={origin} platform={platform} />
      </div>

      <div className="case-search-row__main">
        <div className="case-search-row__head">
          <div className="case-search-row__titles">
            <Link to={`/cases/${caseRec.id}`} className="case-search-row__title">
              {caseRec.title}
            </Link>
            {caseRec.ingest_source && caseRec.ingest_source !== caseRec.title && (
              <p className="case-search-row__subtitle muted text-xs">
                Case title · ingest source <code className="mono">{source}</code>
              </p>
            )}
          </div>
          <div className="case-search-row__badges">
            <span className={`case-search-row__origin case-search-row__origin--${origin}`}>
              {ORIGIN_LABELS[origin]}
            </span>
            {platform && (
              <span className={`case-search-row__platform case-search-row__platform--${platform}`}>
                <CasePlatformIcon platform={platform} size={11} />
                {PLATFORM_LABELS[platform]}
              </span>
            )}
            <Badge variant={caseStatusVariant(caseRec.status)}>{caseRec.status}</Badge>
            {priorityClass(caseRec.priority) ? (
              <span className={`badge ${priorityClass(caseRec.priority)}`}>{caseRec.priority}</span>
            ) : (
              <Badge>{caseRec.priority}</Badge>
            )}
            {reingested ? (
              <span
                className="case-search-row__reingest"
                title={
                  lastIngestAbs
                    ? t("cases.searchReingestedHint", {
                        when: lastIngestAbs,
                        count: ingestRuns,
                      })
                    : t("cases.searchReingestedBadge")
                }
              >
                <RotateCcw size={11} aria-hidden />
                {t("cases.searchReingestedBadge")}
                {ingestRuns > 1 ? ` · ${ingestRuns}×` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="case-search-row__metrics">
          {deviceLabel ? (
            <span className="case-search-row__metric" title={t("cases.searchDeviceLabel")}>
              <Smartphone size={12} aria-hidden />
              {deviceLabel}
            </span>
          ) : null}
          {caseRec.event_count != null && (
            <span className="case-search-row__metric">
              <Database size={12} aria-hidden />
              {caseRec.event_count.toLocaleString()} events
            </span>
          )}
          <span className={`case-search-row__metric${caseRec.alert_count > 0 ? " case-search-row__metric--alert" : ""}`}>
            <Bell size={12} aria-hidden />
            {caseRec.alert_count} alert{caseRec.alert_count === 1 ? "" : "s"}
          </span>
          {caseRec.alert_count > 0 && (
            <span className="case-search-row__metric case-search-row__metric--warn">
              <AlertTriangle size={12} aria-hidden />
              Needs review
            </span>
          )}
        </div>

        <div className="case-search-row__timeline" aria-label={t("cases.searchTimelineLabel")}>
          <div className="case-search-row__timebox" title={createdAbs}>
            <span className="case-search-row__timebox-label">{t("cases.searchFirstIngestLabel")}</span>
            <span className="case-search-row__timebox-rel">{created}</span>
            <span className="case-search-row__timebox-abs muted mono text-xs">{createdAbs}</span>
          </div>
          {showLastIngest ? (
            <div
              className={`case-search-row__timebox${reingested ? " case-search-row__timebox--reingest" : ""}`}
              title={lastIngestAbs}
            >
              <span className="case-search-row__timebox-label">
                {reingested ? <RotateCcw size={11} aria-hidden /> : null}
                {reingested
                  ? t("cases.searchLastReingestLabel")
                  : t("cases.searchLastIngestLabel")}
              </span>
              <span className="case-search-row__timebox-rel">{lastIngestRel}</span>
              <span className="case-search-row__timebox-abs muted mono text-xs">
                {lastIngestAbs}
                {ingestRuns > 1 ? ` · ${t("cases.searchIngestRuns", { count: ingestRuns })}` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <dl className="case-search-row__facts">
          <div className="case-search-row__fact case-search-row__fact--source">
            <dt>Ingest source</dt>
            <dd>
              <code className="mono case-search-row__source">{source}</code>
              <button
                type="button"
                className="case-search-row__copy"
                title={copied ? "Copied" : "Copy source label"}
                onClick={() => void copySource()}
              >
                <Copy size={12} aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
            </dd>
          </div>
          <div className="case-search-row__fact">
            <dt>Device owner</dt>
            <dd className="case-search-row__owner">
              {isEditingOwner ? (
                <span className="case-search-row__owner-edit">
                  <input
                    className="case-search-row__owner-input"
                    value={editingUser.value}
                    onChange={(e) => onEditUserChange(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => void onSaveUser(caseRec, editingUser.value.trim())}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={onCancelEditUser}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <>
                  <span>{caseRec.user || "—"}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => onStartEditUser(caseRec)}
                  >
                    Edit
                  </Button>
                  {caseRec.user && (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => onFilterOwner(caseRec.user)}
                    >
                      Filter
                    </Button>
                  )}
                </>
              )}
            </dd>
          </div>
          <div className="case-search-row__fact">
            <dt>Case ID</dt>
            <dd className="mono text-xs" title={caseRec.id}>
              {shortId}…
            </dd>
          </div>
        </dl>

        {summary && <p className="case-search-row__description muted text-sm">{summary}</p>}

        {visibleTags.length > 0 && (
          <ul className="case-search-row__tags">
            {visibleTags.map((tag) => (
              <li key={tag}>
                <button type="button" className="pill case-search-row__tag" onClick={() => onFilterTag(tag)}>
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="case-search-row__actions">
          <Button size="sm" variant="secondary" asChild>
            <Link to={`/cases/${caseRec.id}`}>Open case</Link>
          </Button>
          {caseRec.alert_count > 0 && (
            <Button size="sm" variant="secondary" asChild>
              <Link
                to={`/alerts?case_id=${caseRec.id}&case_title=${encodeURIComponent(caseRec.title)}`}
              >
                Alerts ({caseRec.alert_count})
              </Link>
            </Button>
          )}
          <Button size="sm" variant="secondary" asChild>
            <Link to={`/search?source=${encodeURIComponent(source)}&run=1`}>
              <Search size={12} aria-hidden />
              Search events
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/data">Data</Link>
          </Button>
          {quickLink && (
            <Button size="sm" variant="ghost" asChild>
              <Link to={quickLink.to}>{quickLink.label}</Link>
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="case-search-row__delete"
              disabled={deleting}
              onClick={() => {
                const msg = caseRec.ingest_source
                  ? `Delete case “${caseRec.title}” and all ingested events, IronSift runs, and ingest jobs for source ${source}?`
                  : `Delete case “${caseRec.title}”?`;
                if (!window.confirm(msg)) return;
                void onDelete(caseRec);
              }}
            >
              <Trash2 size={12} aria-hidden />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
