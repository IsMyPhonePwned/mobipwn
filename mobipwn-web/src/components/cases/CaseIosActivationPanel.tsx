import { useMemo } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_ACTIVATION_PANEL_ID } from "@/lib/caseDashboard";
import { activationSummaryFromRows, iosParserQuery } from "@/lib/iosParserData";

export function CaseIosActivationPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_ACTIVATION_PANEL_ID,
      title: "Activation",
      query: iosParserQuery(src, "mobileactivation", "| fields message, ext | head 40"),
      viz: "table",
      layout: { i: CASE_IOS_ACTIVATION_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const summary = useMemo(() => activationSummaryFromRows(rows), [rows]);
  const scope = `source="${src}" parser="mobileactivation"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-activation case-ios-activation--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-activation case-ios-activation--error muted text-xs">{error}</p>;
  }

  if (!summary) {
    return (
      <p className="case-ios-activation case-ios-activation--empty muted text-xs">
        No mobileactivation startup data in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-activation">
      <header className="case-ios-activation__hero">
        <KeyRound size={18} aria-hidden />
        <span className="case-ios-activation__state">{summary.state}</span>
      </header>

      <dl className="case-ios-activation__grid">
        <div>
          <dt>SoC</dt>
          <dd className="mono">{summary.socGeneration}</dd>
        </div>
        <div>
          <dt>Baseband</dt>
          <dd>{summary.hasBaseband}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd className="mono">{summary.buildVersion}</dd>
        </div>
      </dl>

      <p className="case-ios-activation__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 50`)}>Search mobileactivation</Link>
      </p>
    </div>
  );
}
