import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import {
  createPanel,
  fetchDashboardDocument,
  inferViz,
  saveDashboardDocument,
  type DashboardRecord,
  type PanelViz,
} from "@/lib/dashboard";

type Props = {
  open: boolean;
  onClose: () => void;
  query: string;
  columns: string[];
  suggestedViz?: PanelViz;
};

const VIZ_OPTIONS: PanelViz[] = ["bar", "line", "area", "pie", "table", "single_value", "timechart"];

export function AddToDashboardDialog({ open, onClose, query, columns, suggestedViz }: Props) {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<DashboardRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("default");
  const [title, setTitle] = useState("New panel");
  const [viz, setViz] = useState<PanelViz>(suggestedViz ?? inferViz(query, columns));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setViz(suggestedViz ?? inferViz(query, columns));
    setTitle("New panel");
    setError("");
    void apiFetch<DashboardRecord[]>("/v1/dashboards")
      .then((list) => setDashboards(list))
      .catch(() => setDashboards([]));
  }, [open, query, columns, suggestedViz]);

  const save = useCallback(async () => {
    if (!query.trim()) return;
    setSaving(true);
    setError("");
    try {
      const doc = await fetchDashboardDocument(selectedId);
      const panel = createPanel({
        title: title.trim() || "Panel",
        query,
        viz,
        panels: doc.panels,
      });
      await saveDashboardDocument({ ...doc, panels: [...doc.panels, panel] }, selectedId);
      log("info", t("dashboards.panelAdded"), panel.title);
      onClose();
      navigate("/dashboards", { state: { panelAdded: panel.title, panelId: panel.id } });
    } catch (e) {
      const msg = String(e);
      setError(msg);
      log("error", t("dashboards.addPanelFailed"), msg);
    } finally {
      setSaving(false);
    }
  }, [query, title, viz, selectedId, onClose, navigate, log, t]);

  if (!open) return null;

  return (
    <div className="dashboard-dialog-backdrop" onClick={onClose}>
      <div className="dashboard-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="dashboard-dialog-header">
          <LayoutDashboard size={18} />
          <h2>{t("dashboards.addToDashboard")}</h2>
        </header>
        <div className="dashboard-dialog-body">
          <label className="dashboard-dialog-field">
            <span>{t("dashboards.panelTitle")}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="dashboard-dialog-field">
            <span>{t("dashboards.vizType")}</span>
            <select value={viz} onChange={(e) => setViz(e.target.value as PanelViz)}>
              {VIZ_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="dashboard-dialog-field">
            <span>{t("dashboards.targetDashboard")}</span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="default">{t("dashboards.defaultDashboard")}</option>
              {dashboards
                .filter((d) => !d.is_default)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="dashboard-dialog-query">{query}</p>
          {error && <p className="dashboard-panel-error">{error}</p>}
        </div>
        <footer className="dashboard-dialog-footer">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !query.trim()}>
            {saving ? t("common.save") + "…" : t("dashboards.addPanel")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
