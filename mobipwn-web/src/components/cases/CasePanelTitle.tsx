import { CardTitle } from "@/components/ui/card";
import type { PanelViz } from "@/lib/dashboard";
import { resolveCasePanelTheme } from "@/lib/casePanelTheme";

const VIZ_LABEL: Partial<Record<PanelViz, string>> = {
  table: "Table",
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  timechart: "Timeline",
  single_value: "Metric",
};

export function CasePanelTitle({
  title,
  viz,
}: {
  title: string;
  viz?: PanelViz;
}) {
  const vizLabel = viz ? VIZ_LABEL[viz] : undefined;

  return (
    <CardTitle className="case-panel-title">
      <span className="case-panel-title__text">{title}</span>
      {vizLabel && <span className="case-panel-title__viz">{vizLabel}</span>}
    </CardTitle>
  );
}

export function casePanelCardProps(panel: { id: string; viz: PanelViz }) {
  return {
    "data-case-theme": resolveCasePanelTheme(panel),
    "data-case-panel": panel.id,
  } as const;
}
