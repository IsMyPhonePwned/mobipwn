import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { useAuth } from "@/contexts/AuthContext";
import { buildSearchHref } from "@/lib/mplQuery";
import { apiFetch } from "@/lib/api";
import {
  CaseReingestPanel,
  type CaseReingestPanelHandle,
} from "@/components/cases/CaseReingestPanel";
import {
  fetchCase,
  fetchCaseAlerts,
  fetchCaseEntities,
  fetchCaseWall,
  closeCase,
  deleteCase,
  type CaseEntitiesResponse,
  type CaseRecord,
  type CaseWallEntry,
} from "@/lib/cases";
import { hasPermission } from "@/lib/permissions";
import {
  CaseInvestigationPanel,
  type CaseIngestJob,
  type CaseLinkedAlert,
} from "@/components/cases/CaseInvestigationPanel";
import { CaseDashboardTabs } from "@/components/cases/CaseDashboardTabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { inferCasePlatform } from "@/lib/caseDashboard";
import { useDocumentVisible } from "@/lib/useDocumentVisible";

export default function CaseDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const canWriteCases = hasPermission(user, "cases_write");
  const canWriteAlerts = hasPermission(user, "alerts_write");
  const canIngest = hasPermission(user, "ingest_write");
  const tabVisible = useDocumentVisible();
  const [caseRec, setCaseRec] = useState<CaseRecord | null>(null);
  const [jobs, setJobs] = useState<CaseIngestJob[]>([]);
  const [alerts, setAlerts] = useState<CaseLinkedAlert[]>([]);
  const [entities, setEntities] = useState<CaseEntitiesResponse | null>(null);
  const [wall, setWall] = useState<CaseWallEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);
  const reingestPanelRef = useRef<CaseReingestPanelHandle>(null);
  const hasLoadedRef = useRef(false);

  const casePlatform = useMemo(
    () => (caseRec ? inferCasePlatform(caseRec, jobs) : null),
    [caseRec, jobs]
  );

  const refreshAlertsAndWall = useCallback(async (caseId: string) => {
    const [alertList, wallEntries] = await Promise.all([
      fetchCaseAlerts(caseId),
      fetchCaseWall(caseId).catch(() => [] as CaseWallEntry[]),
    ]);
    setAlerts(alertList as CaseLinkedAlert[]);
    setWall(wallEntries);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const c = await fetchCase(id);
      setCaseRec(c);
      const source = c.ingest_source || c.title;
      const [jobList, alertList, entityData, wallEntries] = await Promise.all([
        source
          ? apiFetch<CaseIngestJob[]>(`/v1/ingest/jobs?source=${encodeURIComponent(source)}&limit=20`)
          : Promise.resolve([] as CaseIngestJob[]),
        fetchCaseAlerts(id),
        c.ingest_source ? fetchCaseEntities(id).catch(() => null) : Promise.resolve(null),
        fetchCaseWall(id).catch(() => [] as CaseWallEntry[]),
      ]);
      setJobs(jobList);
      setAlerts(alertList as CaseLinkedAlert[]);
      setEntities(entityData);
      setWall(wallEntries);
      hasLoadedRef.current = true;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // When returning from Alerts (or another tab), refresh linked alert statuses without a full reload.
  useEffect(() => {
    if (!tabVisible || !id || !hasLoadedRef.current) return;
    void refreshAlertsAndWall(id).catch(() => {
      /* keep existing list on soft-refresh failure */
    });
  }, [tabVisible, id, refreshAlertsAndWall]);

  const onAlertStatusChanged = useCallback(
    async (alertId: string, status: string) => {
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, status } : a)));
      if (!id) return;
      try {
        await refreshAlertsAndWall(id);
      } catch (e) {
        setError(String(e));
      }
    },
    [id, refreshAlertsAndWall]
  );

  if (loading) return <p className="muted">Loading case…</p>;
  if (!caseRec) return <p className="error">{error || "Case not found"}</p>;

  return (
    <>
      <PageHeader
        title={caseRec.title}
        meta={
          <span className="muted">
            <Link to="/cases/search">Cases</Link> / {caseRec.title}
          </span>
        }
        description={
          <>
            Device owner: <strong>{caseRec.user || "—"}</strong>
            {caseRec.ingest_source && caseRec.ingest_source !== caseRec.title && (
              <>
                {" "}
                · source <code>{caseRec.ingest_source}</code>
              </>
            )}
            {casePlatform && (
              <>
                {" "}
                ·{" "}
                <span
                  className={`platform-case-tops__badge platform-case-tops__badge--${
                    casePlatform === "ios"
                      ? "ios"
                      : casePlatform === "endpoint"
                        ? "endpoint"
                        : "android"
                  }`}
                >
                  <CasePlatformIcon
                    platform={casePlatform}
                    size={12}
                    fallback={null}
                  />
                  {casePlatform === "endpoint"
                    ? "Endpoint"
                    : casePlatform === "ios"
                      ? "iOS"
                      : "Android"}
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            {caseRec.ingest_source && canIngest && (
              <Button
                variant="secondary"
                disabled={actionBusy}
                onClick={() => {
                  document.getElementById("case-reingest")?.scrollIntoView({ behavior: "smooth" });
                  reingestPanelRef.current?.reingestLatest();
                }}
              >
                <RotateCcw size={14} aria-hidden />
                Re-ingest
              </Button>
            )}
            {caseRec.ingest_source && (
              <Button variant="secondary" asChild>
                <Link to={buildSearchHref(`source="${caseRec.ingest_source}"`, { run: true })}>
                  Search events
                </Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link to={`/alerts?case_id=${caseRec.id}`}>Alerts ({alerts.length})</Link>
            </Button>
            {caseRec.status !== "closed" && (
              <Button
                variant="secondary"
                disabled={actionBusy}
                onClick={() => {
                  if (!window.confirm("Close this case?")) return;
                  setActionBusy(true);
                  void closeCase(caseRec.id)
                    .then(() => load())
                    .catch((e) => setError(String(e)))
                    .finally(() => setActionBusy(false));
                }}
              >
                Close case
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={actionBusy}
              onClick={() => {
                const msg = caseRec.ingest_source
                  ? "Delete this case and all ingested events and ingest jobs for this source?"
                  : "Delete this case?";
                if (!window.confirm(msg)) return;
                setActionBusy(true);
                void deleteCase(caseRec.id, !!caseRec.ingest_source)
                  .then(() => {
                    window.location.href = "/cases/search";
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setActionBusy(false));
              }}
            >
              Delete case
            </Button>
          </>
        }
      />

      <CaseInvestigationPanel
        caseRec={caseRec}
        wall={wall}
        jobs={jobs}
        alerts={alerts}
        canWrite={canWriteCases}
        canWriteAlerts={canWriteAlerts}
        onCommentAdded={(entry) => setWall((prev) => [entry, ...prev])}
        onCaseUpdated={setCaseRec}
        onAlertStatusChanged={onAlertStatusChanged}
        onError={setError}
      />

      {error && <p className="error">{error}</p>}

      {caseRec.ingest_source && casePlatform && (
        <CaseReingestPanel
          ref={reingestPanelRef}
          caseId={caseRec.id}
          ingestSource={caseRec.ingest_source}
          platform={casePlatform}
          caseUser={caseRec.user || undefined}
          onComplete={() => {
            setDashboardKey((k) => k + 1);
            void load();
          }}
        />
      )}

      {caseRec.ingest_source && casePlatform && (
        <CaseDashboardTabs
          key={dashboardKey}
          caseId={caseRec.id}
          ingestSource={caseRec.ingest_source}
          platform={casePlatform}
          entities={entities}
          canWriteEntities={canWriteCases}
          onEntitiesChange={setEntities}
        />
      )}

      <div className="case-detail-actions">
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </>
  );
}
