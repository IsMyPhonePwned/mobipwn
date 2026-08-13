import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { type Layout, type LayoutItem, useContainerWidth } from "react-grid-layout";
import GridLayout from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Download,
  GripVertical,
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { CasePlatformIcon } from "@/components/icons/PlatformIcons";
import { DashboardPanelCard } from "@/components/dashboard/DashboardPanelCard";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { apiFetch } from "@/lib/api";
import {
  createPanel,
  DEFAULT_MOBILE_DASHBOARD,
  isBuiltInDashboardPanel,
  parseDashboardDocument,
  REFRESH_OPTIONS,
  saveDashboardDocument,
  updatePanelLayout,
  type DashboardDocument,
  type DashboardPanel,
  type DashboardRecord,
  type PanelViz,
} from "@/lib/dashboard";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/input";
import { TIME_RANGE_PRESETS } from "@/lib/timeRange";

type Overview = {
  events_24h: number;
  alerts_new: number;
  cases_total?: number;
  cases_android?: number;
  cases_ios?: number;
  cases_endpoint?: number;
};

const VIZ_OPTIONS: PanelViz[] = ["bar", "line", "area", "pie", "table", "single_value", "timechart"];

export default function DashboardsPage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [record, setRecord] = useState<DashboardRecord | null>(null);
  const [doc, setDoc] = useState<DashboardDocument>(() => ({
    ...DEFAULT_MOBILE_DASHBOARD,
    panels: [...DEFAULT_MOBILE_DASHBOARD.panels],
  }));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [editingPanel, setEditingPanel] = useState<DashboardPanel | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addedBanner, setAddedBanner] = useState<string | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<LayoutItem[] | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const editSnapshotRef = useRef<DashboardDocument | null>(null);
  const { width: gridWidth, containerRef, mounted: gridMounted } = useContainerWidth();

  const panelsToLayout = useCallback(
    (panels: DashboardPanel[]): LayoutItem[] => panels.map((p) => ({ ...p.layout, i: p.id })),
    []
  );

  const cloneDoc = useCallback(
    (source: DashboardDocument): DashboardDocument => ({
      ...source,
      panels: source.panels.map((p) => ({ ...p, layout: { ...p.layout } })),
    }),
    []
  );

  const enterEditMode = useCallback(() => {
    editSnapshotRef.current = cloneDoc(doc);
    setLayoutDraft(panelsToLayout(doc.panels));
    setEditMode(true);
  }, [cloneDoc, doc, panelsToLayout]);

  const cancelEditMode = useCallback(() => {
    if (editSnapshotRef.current) {
      setDoc(editSnapshotRef.current);
    }
    editSnapshotRef.current = null;
    setLayoutDraft(null);
    setEditMode(false);
    setEditingPanel(null);
  }, []);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
      cancelEditMode();
      return;
    }
    enterEditMode();
  }, [editMode, cancelEditMode, enterEditMode]);

  const loadDashboard = useCallback(async () => {
    try {
      const d = await apiFetch<DashboardRecord>("/v1/dashboards/default");
      setRecord(d);
      setDoc(parseDashboardDocument(d.layout));
    } catch {
      setRecord(null);
      setDoc({ ...DEFAULT_MOBILE_DASHBOARD, panels: [...DEFAULT_MOBILE_DASHBOARD.panels] });
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    fetch("/api/v1/overview")
      .then((r) => r.json())
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [loadDashboard]);

  useEffect(() => {
    const state = location.state as { panelAdded?: string; panelId?: string } | null;
    if (!state?.panelAdded) return;
    setAddedBanner(state.panelAdded);
    void loadDashboard().then(() => {
      if (state.panelId) {
        requestAnimationFrame(() => {
          document
            .getElementById(`dashboard-panel-${state.panelId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
      navigate("/dashboards", { replace: true, state: null });
    });
  }, [location.state, loadDashboard, navigate]);

  const refreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setLastRefresh(new Date());
    fetch("/api/v1/overview")
      .then((r) => r.json())
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  useEffect(() => {
    if (!doc.refresh_sec) return;
    const id = window.setInterval(refreshAll, doc.refresh_sec * 1000);
    return () => window.clearInterval(id);
  }, [doc.refresh_sec, refreshAll]);

  const gridLayout: LayoutItem[] = useMemo(() => {
    if (editMode) {
      return layoutDraft ?? panelsToLayout(doc.panels);
    }
    return panelsToLayout(doc.panels);
  }, [editMode, layoutDraft, doc.panels, panelsToLayout]);

  const layoutByPanelId = useMemo(() => {
    const map = new Map<string, LayoutItem>();
    for (const item of gridLayout) map.set(item.i, item);
    return map;
  }, [gridLayout]);

  const syncLayoutDraft = useCallback((layout: Layout) => {
    setLayoutDraft([...layout]);
  }, []);

  const onDragStop = useCallback(
    (layout: Layout) => {
      if (!editMode) return;
      syncLayoutDraft(layout);
    },
    [editMode, syncLayoutDraft]
  );

  const onResizeStop = useCallback(
    (layout: Layout) => {
      if (!editMode) return;
      syncLayoutDraft(layout);
    },
    [editMode, syncLayoutDraft]
  );

  const saveDashboard = useCallback(async () => {
    setSaving(true);
    const docToSave =
      editMode && layoutDraft
        ? {
            ...doc,
            panels: doc.panels.map((p) => {
              const item = layoutDraft.find((l) => l.i === p.id);
              return item ? { ...p, layout: { ...item, i: p.id } } : p;
            }),
          }
        : doc;
    log("info", "Save dashboard", `${docToSave.panels.length} panel(s)`);
    try {
      const saved = await saveDashboardDocument(docToSave);
      setRecord(saved);
      setDoc(parseDashboardDocument(saved.layout));
      editSnapshotRef.current = null;
      setLayoutDraft(null);
      setEditMode(false);
    } catch (e) {
      log("error", "Save dashboard failed", String(e));
    } finally {
      setSaving(false);
    }
  }, [doc, editMode, layoutDraft, log]);

  const addPanel = useCallback(() => {
    const panel = createPanel({
      title: "New panel",
      query: 'last 24h platform="android" | stats count by parser | head 8',
      viz: "bar",
      panels: doc.panels,
    });
    setDoc((d) => ({ ...d, panels: [...d.panels, panel] }));
    if (editMode) {
      setLayoutDraft((draft) =>
        draft ? [...draft, { ...panel.layout, i: panel.id }] : null
      );
    } else {
      const nextDoc = { ...doc, panels: [...doc.panels, panel] };
      editSnapshotRef.current = cloneDoc(nextDoc);
      setLayoutDraft(panelsToLayout(nextDoc.panels));
      setEditMode(true);
    }
    setEditingPanel(panel);
  }, [cloneDoc, doc, editMode, panelsToLayout]);

  const removePanel = useCallback(
    async (id: string) => {
      const panel = doc.panels.find((p) => p.id === id);
      const label = panel?.title ?? id;
      if (!window.confirm(t("dashboards.confirmDeletePanel").replace("{{title}}", label))) return;
      setRemovingId(id);
      log("info", t("dashboards.deletingPanel"), label);
      try {
        const next = { ...doc, panels: doc.panels.filter((p) => p.id !== id) };
        setDoc(next);
        const saved = await saveDashboardDocument(next);
        setRecord(saved);
        setDoc(parseDashboardDocument(saved.layout));
        if (editingPanel?.id === id) setEditingPanel(null);
      } catch (e) {
        log("error", t("dashboards.deletePanelFailed"), String(e));
      } finally {
        setRemovingId(null);
      }
    },
    [doc, editingPanel, log, t]
  );

  const updatePanel = useCallback((updated: DashboardPanel) => {
    const normalized = updatePanelLayout(updated, {});
    setDoc((d) => ({
      ...d,
      panels: d.panels.map((p) => (p.id === normalized.id ? normalized : p)),
    }));
    setLayoutDraft((draft) =>
      draft
        ? draft.map((item) =>
            item.i === normalized.id ? { ...item, ...normalized.layout, i: normalized.id } : item
          )
        : draft
    );
    setEditingPanel(null);
  }, []);

  const patchEditingLayout = useCallback(
    (patch: Partial<Pick<LayoutItem, "x" | "y" | "w" | "h">>) => {
      setEditingPanel((prev) => (prev ? updatePanelLayout(prev, patch) : prev));
    },
    []
  );

  const exportDashboard = useCallback(() => {
    const payload = {
      version: 2,
      exported_at: new Date().toISOString(),
      name: record?.name ?? "Overview",
      document: doc,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mobipwn-dashboard-${record?.name ?? "overview"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log("info", "Exported dashboard");
  }, [doc, record, log]);

  const importDashboard = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as { document?: unknown; layout?: unknown };
        const next = parseDashboardDocument(parsed.document ?? parsed.layout ?? parsed);
        editSnapshotRef.current = cloneDoc(next);
        setDoc(next);
        setLayoutDraft(panelsToLayout(next.panels));
        setEditMode(true);
        log("info", "Imported dashboard JSON");
      } catch (e) {
        log("error", "Import dashboard failed", String(e));
      }
    },
    [log, cloneDoc, panelsToLayout]
  );

  return (
    <>
      <PageHeader title={t("pages.dashboards")} description={t("dashboards.subtitle")} />

      <div className="dashboards-case-stats" aria-label={t("dashboards.caseStatsLabel")}>
        <Link to="/cases/search" className="dashboards-case-stats__item">
          <span className="dashboards-case-stats__value">
            {overview?.cases_total != null ? overview.cases_total.toLocaleString() : "—"}
          </span>
          <span className="dashboards-case-stats__label">{t("dashboards.casesTotal")}</span>
        </Link>
        <Link to="/cases/search?q=android" className="dashboards-case-stats__item dashboards-case-stats__item--android">
          <CasePlatformIcon platform="android" size={14} />
          <span className="dashboards-case-stats__value">
            {overview?.cases_android != null ? overview.cases_android.toLocaleString() : "—"}
          </span>
          <span className="dashboards-case-stats__label">{t("dashboards.casesAndroid")}</span>
        </Link>
        <Link to="/cases/search?q=ios" className="dashboards-case-stats__item dashboards-case-stats__item--ios">
          <CasePlatformIcon platform="ios" size={14} />
          <span className="dashboards-case-stats__value">
            {overview?.cases_ios != null ? overview.cases_ios.toLocaleString() : "—"}
          </span>
          <span className="dashboards-case-stats__label">{t("dashboards.casesIos")}</span>
        </Link>
        <Link to="/cases/search?q=endpoint" className="dashboards-case-stats__item dashboards-case-stats__item--endpoint">
          <CasePlatformIcon platform="endpoint" size={14} />
          <span className="dashboards-case-stats__value">
            {overview?.cases_endpoint != null ? overview.cases_endpoint.toLocaleString() : "—"}
          </span>
          <span className="dashboards-case-stats__label">{t("dashboards.casesEndpoint")}</span>
        </Link>
      </div>

      <div className="dashboards-page-toolbar">
        <label className="dashboard-toolbar-select">
          <span>{t("dashboards.timeRange")}</span>
          <select
            value={doc.time_preset}
            onChange={(e) => setDoc((d) => ({ ...d, time_preset: e.target.value }))}
          >
            {TIME_RANGE_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-toolbar-select">
          <span>{t("dashboards.autoRefresh")}</span>
          <select
            value={doc.refresh_sec}
            onChange={(e) => setDoc((d) => ({ ...d, refresh_sec: Number(e.target.value) }))}
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.sec} value={o.sec}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={refreshAll} title={t("common.refresh")}>
          <RefreshCw size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={exportDashboard}>
          <Download size={14} />
          {t("dashboards.export")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
          <Upload size={14} />
          {t("dashboards.import")}
        </Button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importDashboard(f);
            e.target.value = "";
          }}
        />
        <Button variant={editMode ? "default" : "secondary"} size="sm" onClick={toggleEditMode}>
          <Pencil size={14} />
          {editMode ? t("dashboards.editing") : t("dashboards.edit")}
        </Button>
        {editMode && (
          <>
            <Button variant="ghost" size="sm" onClick={addPanel}>
              <Plus size={14} />
              {t("dashboards.addPanel")}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEditMode}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void saveDashboard()} disabled={saving}>
              {saving ? t("common.save") + "…" : t("dashboards.saveDashboard")}
            </Button>
          </>
        )}
      </div>

      {addedBanner && (
        <p className="dashboard-added-banner">
          {t("dashboards.panelAdded")}: <strong>{addedBanner}</strong>
        </p>
      )}

      {lastRefresh && (
        <p className="dashboard-last-refresh">
          {t("dashboards.lastRefresh")}: {lastRefresh.toLocaleTimeString()}
        </p>
      )}

      {editMode && (
        <div className="dashboard-edit-banner" role="status">
          <Pencil size={14} aria-hidden />
          <span>{t("dashboards.editLayoutHint")}</span>
        </div>
      )}

      <div
        ref={containerRef}
        className={`dashboard-grid-wrap${editMode ? " dashboard-grid-wrap--editing" : ""}`}
      >
        {gridMounted && gridWidth > 0 && gridLayout.length > 0 && (
          <GridLayout
            key={editMode ? "dashboard-grid-edit" : "dashboard-grid-view"}
            className="layout"
            layout={gridLayout}
            width={gridWidth}
            cols={12}
            rowHeight={72}
            margin={[10, 10]}
            containerPadding={[0, 0]}
            compactType="vertical"
            isDraggable={editMode}
            isResizable={editMode}
            draggableHandle={editMode ? ".dashboard-grid-drag-handle" : undefined}
            draggableCancel=".dashboard-no-drag"
            resizeHandles={["se", "e", "s"]}
            onDragStop={onDragStop}
            onResizeStop={onResizeStop}
          >
            {doc.panels.map((panel) => {
              const itemLayout = layoutByPanelId.get(panel.id);
              return (
                <div key={panel.id} id={`dashboard-panel-${panel.id}`} className="dashboard-grid-item h-full">
                  {editMode && (
                    <div
                      className="dashboard-grid-drag-handle"
                      title={t("dashboards.dragToMove")}
                    >
                      <GripVertical size={14} aria-hidden />
                      <span className="dashboard-grid-drag-label">{t("dashboards.dragToMove")}</span>
                      {itemLayout && (
                        <span className="dashboard-panel-size-badge mono">
                          {itemLayout.w}×{itemLayout.h}
                        </span>
                      )}
                    </div>
                  )}
                  <DashboardPanelCard
                    panel={panel}
                    timePreset={doc.time_preset}
                    refreshKey={refreshKey}
                    editMode={editMode}
                    overview={overview}
                    removing={removingId === panel.id}
                    onEdit={() => setEditingPanel(panel)}
                    onRemove={() => void removePanel(panel.id)}
                  />
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      {!editMode && (
        <p className="dashboard-footer-hint">
          <LayoutDashboard size={14} />
          {t("dashboards.hint")}{" "}
          <Link to="/search">{t("common.openSearch")}</Link>
          {" · "}
          <button type="button" className="dashboard-inline-link" onClick={enterEditMode}>
            {t("dashboards.editLayoutLink")}
          </button>
        </p>
      )}

      {editingPanel && (
        <div className="dashboard-dialog-backdrop" onClick={() => setEditingPanel(null)}>
          <div className="dashboard-dialog" onClick={(e) => e.stopPropagation()}>
            <header className="dashboard-dialog-header">
              <Pencil size={18} />
              <h2>{t("dashboards.editPanel")}</h2>
            </header>
            <div className="dashboard-dialog-body">
              <label className="dashboard-dialog-field">
                <span>{t("dashboards.panelTitle")}</span>
                <Input
                  value={editingPanel.title}
                  onChange={(e) => setEditingPanel({ ...editingPanel, title: e.target.value })}
                />
              </label>
              {isBuiltInDashboardPanel(editingPanel.id) ? (
                <p className="dashboard-dialog-builtin muted">{t("dashboards.builtinPanelHint")}</p>
              ) : (
                <>
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.vizType")}</span>
                    <select
                      value={editingPanel.viz}
                      onChange={(e) =>
                        setEditingPanel({ ...editingPanel, viz: e.target.value as PanelViz })
                      }
                    >
                      {VIZ_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.panelQuery")}</span>
                    <textarea
                      className="dashboard-query-editor"
                      rows={4}
                      value={editingPanel.query}
                      onChange={(e) => setEditingPanel({ ...editingPanel, query: e.target.value })}
                      placeholder='last 24h platform="android" | stats count by parser | head 8'
                    />
                  </label>
                </>
              )}
              <fieldset className="dashboard-layout-fields">
                <legend>{t("dashboards.panelLayout")}</legend>
                <p className="dashboard-layout-fields-hint muted">{t("dashboards.panelLayoutHint")}</p>
                <div className="dashboard-layout-fields-grid">
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.layoutWidth")}</span>
                    <Input
                      type="number"
                      min={editingPanel.layout.minW ?? 2}
                      max={12}
                      value={editingPanel.layout.w}
                      onChange={(e) => patchEditingLayout({ w: Number(e.target.value) })}
                    />
                  </label>
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.layoutHeight")}</span>
                    <Input
                      type="number"
                      min={editingPanel.layout.minH ?? 2}
                      max={24}
                      value={editingPanel.layout.h}
                      onChange={(e) => patchEditingLayout({ h: Number(e.target.value) })}
                    />
                  </label>
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.layoutX")}</span>
                    <Input
                      type="number"
                      min={0}
                      max={11}
                      value={editingPanel.layout.x}
                      onChange={(e) => patchEditingLayout({ x: Number(e.target.value) })}
                    />
                  </label>
                  <label className="dashboard-dialog-field">
                    <span>{t("dashboards.layoutY")}</span>
                    <Input
                      type="number"
                      min={0}
                      value={editingPanel.layout.y}
                      onChange={(e) => patchEditingLayout({ y: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </fieldset>
            </div>
            <footer className="dashboard-dialog-footer">
              <Button variant="ghost" onClick={() => setEditingPanel(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => updatePanel(editingPanel)}>{t("common.save")}</Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
