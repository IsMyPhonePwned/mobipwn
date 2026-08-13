import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import GridLayout from "react-grid-layout/legacy";
import { type Layout, type LayoutItem, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { GripVertical, Pencil, Plus, RefreshCw } from "lucide-react";
import { CaseDashboardPanelCard } from "@/components/cases/CaseDashboardPanelCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/LocaleContext";
import {
  updatePanelLayout,
  type DashboardDocument,
  type DashboardPanel,
  type PanelViz,
} from "@/lib/dashboard";
import {
  casePlatformLabel,
  clearSavedCaseDashboard,
  createCaseDashboardPanel,
  hasSavedCaseDashboard,
  isCaseBuiltinPanel,
  resolveCaseDashboard,
  saveCaseDashboard,
  scopeQueryToCase,
  type CaseDashboardSectionId,
  type CasePlatform,
} from "@/lib/caseDashboard";

const VIZ_OPTIONS: PanelViz[] = ["bar", "line", "area", "pie", "table", "single_value", "timechart"];

export function CaseDashboardSection({
  caseId,
  ingestSource,
  platform,
  section = "overview",
  embedded = false,
}: {
  caseId: string;
  ingestSource: string;
  platform: CasePlatform;
  section?: CaseDashboardSectionId;
  /** Render inside case dashboard tabs (no outer card / page title). */
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const [doc, setDoc] = useState<DashboardDocument>(() =>
    resolveCaseDashboard(caseId, platform, ingestSource, section)
  );
  const [editMode, setEditMode] = useState(false);
  const [editingPanel, setEditingPanel] = useState<DashboardPanel | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<LayoutItem[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [customized, setCustomized] = useState(false);
  const editSnapshotRef = useRef<DashboardDocument | null>(null);
  const { width: gridWidth, containerRef, mounted: gridMounted } = useContainerWidth();

  useEffect(() => {
    setDoc(resolveCaseDashboard(caseId, platform, ingestSource, section));
    setEditMode(false);
    setEditingPanel(null);
    setLayoutDraft(null);
    setCustomized(hasSavedCaseDashboard(caseId, platform, section));
  }, [caseId, platform, ingestSource, section]);

  useEffect(() => {
    if (!doc.refresh_sec || doc.refresh_sec <= 0) return;
    const timer = window.setInterval(() => setRefreshKey((k) => k + 1), doc.refresh_sec * 1000);
    return () => window.clearInterval(timer);
  }, [doc.refresh_sec]);

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

  const gridLayout: LayoutItem[] = useMemo(() => {
    if (editMode && layoutDraft) return layoutDraft;
    return panelsToLayout(doc.panels);
  }, [editMode, layoutDraft, doc.panels, panelsToLayout]);

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

  const persistDoc = useCallback(
    (next: DashboardDocument) => {
      saveCaseDashboard(caseId, platform, next, ingestSource, section);
      setDoc(resolveCaseDashboard(caseId, platform, ingestSource, section));
      setCustomized(true);
    },
    [caseId, ingestSource, platform, section]
  );

  const saveEdits = useCallback(() => {
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
    persistDoc(docToSave);
    editSnapshotRef.current = null;
    setLayoutDraft(null);
    setEditMode(false);
    setEditingPanel(null);
  }, [doc, editMode, layoutDraft, persistDoc]);

  const resetDashboard = useCallback(() => {
    if (!window.confirm(t("cases.dashboardResetConfirm"))) return;
    clearSavedCaseDashboard(caseId, platform, section);
    const fresh = resolveCaseDashboard(caseId, platform, ingestSource, section);
    setDoc(fresh);
    setCustomized(false);
    setEditMode(false);
    setEditingPanel(null);
    setLayoutDraft(null);
    editSnapshotRef.current = null;
    setRefreshKey((k) => k + 1);
  }, [caseId, ingestSource, platform, section, t]);

  const addPanel = useCallback(() => {
    const raw = createCaseDashboardPanel(doc.panels);
    const panel = { ...raw, query: scopeQueryToCase(raw.query, ingestSource) };
    const next = { ...doc, panels: [...doc.panels, panel] };
    setDoc(next);
    if (editMode) {
      setLayoutDraft((draft) => (draft ? [...draft, { ...panel.layout, i: panel.id }] : null));
    } else {
      editSnapshotRef.current = cloneDoc(next);
      setLayoutDraft(panelsToLayout(next.panels));
      setEditMode(true);
    }
    setEditingPanel(panel);
  }, [cloneDoc, doc, editMode, ingestSource, panelsToLayout]);

  const removePanel = useCallback(
    (id: string) => {
      const panel = doc.panels.find((p) => p.id === id);
      const label = panel?.title ?? id;
      if (!window.confirm(t("dashboards.confirmDeletePanel").replace("{{title}}", label))) return;
      const next = { ...doc, panels: doc.panels.filter((p) => p.id !== id) };
      setDoc(next);
      setLayoutDraft((draft) => (draft ? draft.filter((l) => l.i !== id) : null));
      if (editingPanel?.id === id) setEditingPanel(null);
    },
    [doc, editingPanel, t]
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

  const onDragStop = useCallback((layout: Layout) => {
    setLayoutDraft([...layout]);
  }, []);

  const onResizeStop = useCallback((layout: Layout) => {
    setLayoutDraft([...layout]);
  }, []);

  const sectionHint = (() => {
    switch (section) {
      case "crashes":
        return t("cases.dashboardCrashesHint");
      case "network":
        return t("cases.dashboardNetworkHint");
      case "packages":
        return t("cases.dashboardPackagesHint");
      case "processes":
        return t("cases.dashboardProcessesHint");
      case "process_events":
        return t("cases.dashboardProcessEventsHint");
      case "battery":
        return t("cases.dashboardBatteryHint");
      case "external_devices":
        return t("cases.dashboardExternalDevicesHint");
      case "authentication":
        return t("cases.dashboardAuthenticationHint");
      case "entities":
        return t("cases.dashboardEntitiesHint");
      default:
        return t("cases.dashboardHint");
    }
  })();

  const toolbar = (
    <>
      <div className="case-detail-dashboard__subheader">
        <p className="muted text-xs case-detail-dashboard__hint">{sectionHint}</p>
        {customized && (
          <span className="case-detail-dashboard__customized">{t("cases.dashboardCustomized")}</span>
        )}
      </div>
      <div className="case-detail-dashboard__actions">
        <Button variant="ghost" size="sm" onClick={() => setRefreshKey((k) => k + 1)} title={t("common.refresh")}>
          <RefreshCw size={14} />
        </Button>
        {!editMode ? (
          <>
            <Button variant="secondary" size="sm" onClick={enterEditMode}>
              <Pencil size={14} />
              {t("cases.dashboardEdit")}
            </Button>
            {customized && (
              <Button variant="ghost" size="sm" onClick={resetDashboard}>
                {t("cases.dashboardReset")}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={addPanel}>
              <Plus size={14} />
              {t("dashboards.addPanel")}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEditMode}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={saveEdits}>
              {t("cases.dashboardSave")}
            </Button>
          </>
        )}
        {!embedded && (
          <Button variant="secondary" size="sm" asChild>
            <Link to="/dashboards">{t("cases.dashboardFleetLink")}</Link>
          </Button>
        )}
      </div>
    </>
  );

  const grid = (
    <>
      {editMode && (
        <div className="dashboard-edit-banner" role="status">
          <Pencil size={14} aria-hidden />
          <span>{t("cases.dashboardEditHint")}</span>
        </div>
      )}

      <div
        ref={containerRef}
        className={`dashboard-grid-wrap case-detail-dashboard__grid${editMode ? " dashboard-grid-wrap--editing" : ""}`}
      >
        {gridMounted && gridWidth > 0 && gridLayout.length > 0 && (
          <GridLayout
            key={editMode ? `case-dashboard-edit-${section}` : `case-dashboard-view-${section}`}
            className="layout"
            layout={gridLayout}
            width={gridWidth}
            cols={12}
            rowHeight={72}
            margin={[10, 10]}
            containerPadding={[0, 0]}
            compactType={editMode ? "vertical" : null}
            isDraggable={editMode}
            isResizable={editMode}
            draggableHandle={editMode ? ".dashboard-grid-drag-handle" : undefined}
            draggableCancel=".dashboard-no-drag"
            resizeHandles={["se", "e", "s"]}
            onDragStop={onDragStop}
            onResizeStop={onResizeStop}
          >
            {doc.panels.map((panel) => (
              <div key={panel.id} className="dashboard-grid-item h-full case-grid-item">
                {editMode && (
                  <div className="dashboard-grid-drag-handle" title={t("dashboards.dragToMove")}>
                    <GripVertical size={14} aria-hidden />
                  </div>
                )}
                <CaseDashboardPanelCard
                  panel={panel}
                  ingestSource={ingestSource}
                  platform={platform}
                  timePreset={doc.time_preset}
                  refreshKey={refreshKey}
                  editMode={editMode}
                  onEdit={() => setEditingPanel(panel)}
                  onRemove={editMode ? () => removePanel(panel.id) : undefined}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>
    </>
  );

  const editDialog = editingPanel ? (
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
          {isCaseBuiltinPanel(editingPanel.id) ? (
            <p className="dashboard-dialog-builtin muted">{t("cases.dashboardBuiltinPanelHint")}</p>
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
                  rows={5}
                  value={editingPanel.query}
                  onChange={(e) => setEditingPanel({ ...editingPanel, query: e.target.value })}
                  placeholder='parser="Package" | stats count by bundle_id | head 8'
                />
                <span className="muted text-xs">{t("cases.dashboardQueryHint")}</span>
              </label>
            </>
          )}
          <fieldset className="dashboard-layout-fields">
            <legend>{t("dashboards.panelLayout")}</legend>
            <div className="dashboard-layout-fields-grid">
              <label className="dashboard-dialog-field">
                <span>{t("dashboards.layoutWidth")}</span>
                <Input
                  type="number"
                  min={2}
                  max={12}
                  value={editingPanel.layout.w}
                  onChange={(e) => patchEditingLayout({ w: Number(e.target.value) })}
                />
              </label>
              <label className="dashboard-dialog-field">
                <span>{t("dashboards.layoutHeight")}</span>
                <Input
                  type="number"
                  min={2}
                  max={24}
                  value={editingPanel.layout.h}
                  onChange={(e) => patchEditingLayout({ h: Number(e.target.value) })}
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
  ) : null;

  if (embedded) {
    return (
      <div className="case-dashboard-section-embedded">
        <div className="case-detail-dashboard__toolbar">{toolbar}</div>
        {grid}
        {editDialog}
      </div>
    );
  }

  const sectionTitle =
    section === "network"
      ? t("cases.dashboardNetworkTitle", { platform: casePlatformLabel(platform) })
      : t("cases.dashboardTitle", { platform: casePlatformLabel(platform) });

  return (
    <section
      className={`card case-detail-dashboard${section === "network" ? " case-detail-dashboard--network" : ""}`}
    >
      <header className="case-detail-dashboard__header">
        <div>
          <h2 className="case-detail-dashboard__title">{sectionTitle}</h2>
        </div>
        {toolbar}
      </header>
      {grid}
      {editDialog}
    </section>
  );
}
