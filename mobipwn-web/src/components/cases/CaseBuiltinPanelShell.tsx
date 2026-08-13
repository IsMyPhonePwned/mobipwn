import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CasePanelTitle, casePanelCardProps } from "@/components/cases/CasePanelTitle";

export function CaseBuiltinPanelShell({
  panelId,
  title,
  viz = "table",
  bodyClassName,
  editMode,
  onEdit,
  onRemove,
  children,
}: {
  panelId: string;
  title: string;
  viz?: import("@/lib/dashboard").PanelViz;
  bodyClassName?: string;
  editMode: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();

  return (
    <Card
      className={`dashboard-panel-card case-panel-card h-full${editMode ? " dashboard-panel-card--editing" : ""}`}
      {...casePanelCardProps({ id: panelId, viz })}
    >
      <CardHeader className="dashboard-panel-header case-panel-header py-2">
        <div className="flex items-center justify-between gap-2">
          <CasePanelTitle title={title} />
          <div className="dashboard-panel-actions flex shrink-0 items-center gap-1 dashboard-no-drag">
            {editMode && onEdit && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onEdit}>
                {t("dashboards.edit")}
              </Button>
            )}
            {onRemove && editMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-[var(--destructive)]"
                title={t("dashboards.deletePanel")}
                onClick={onRemove}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={[
          "dashboard-panel-body case-panel-body dashboard-no-drag",
          bodyClassName ?? "dashboard-panel-body--scroll",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </CardContent>
    </Card>
  );
}
