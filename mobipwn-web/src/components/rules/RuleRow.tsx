import { ChevronRight, Clock, MoreVertical, Play, ShieldCheck, Pencil, Zap } from "lucide-react";
import { ShareShortLink } from "@/components/ShareShortLink";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatLastMatch, RULE_TABLE_COLUMN_COUNT, SEV_META, type RuleView } from "./helpers";
import { RuleCheckbox } from "./RuleCheckbox";
import { RuleRowPreview } from "./RuleRowPreview";

function ActivityStrip({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const total = data.reduce((sum, v) => sum + v, 0);
  return (
    <div className="rules-activity-strip" title={`${total.toLocaleString()} hits in last 28 days`}>
      {data.map((v, i) => (
        <div
          key={i}
          className="rules-activity-bar"
          style={{
            opacity: v === 0 ? 0.12 : 0.3 + (v / max) * 0.7,
            outline: i === data.length - 1 && v > 0 ? "1px solid var(--primary)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

type Props = {
  rule: RuleView;
  expanded: boolean;
  editing?: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onValidate: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  onMute: () => void;
  onDelete: () => void;
  running?: boolean;
};

export function RuleRow({
  rule,
  expanded,
  editing,
  selected,
  onToggle,
  onSelect,
  onEdit,
  onValidate,
  onRun,
  onToggleEnabled,
  onMute,
  onDelete,
  running,
}: Props) {
  const sev = SEV_META[rule.severity];
  const enabled = rule.raw.enabled !== false;

  return (
    <>
      <tr className={cn("rules-row", selected && "selected", editing && "editing", !enabled && "dim")}>
        <td className="rules-sev-bar" style={{ background: sev.color }} title={sev.label} />
        <td className="rules-col-chk">
          <RuleCheckbox checked={selected} onChange={onSelect} ariaLabel={`Select ${rule.name}`} />
        </td>
        <td className="rules-col-exp">
          <button type="button" className="rules-expand-btn" onClick={onToggle} aria-expanded={expanded}>
            <ChevronRight className={cn("rules-band-chevron", expanded && "open")} />
          </button>
        </td>
        <td className="rules-num rules-col-hits">{rule.today > 0 ? rule.today.toLocaleString() : "—"}</td>
        <td className="rules-name-cell">
          <div className="rules-name-block">
            <button type="button" className="rules-name-btn" onClick={onEdit}>
              {rule.name}
            </button>
            {(rule.maintainer || rule.mitre) && (
              <div className="rules-name-meta">
                {rule.maintainer && (
                  <span className="rules-name-meta__item" title="Maintainer">
                    {rule.maintainer}
                  </span>
                )}
                {rule.mitre && (
                  <span className="rules-name-meta__item rules-name-meta__item--mitre" title="MITRE">
                    {rule.mitre}
                  </span>
                )}
              </div>
            )}
          </div>
        </td>
        <td className="rules-activity-col rules-col-trend">
          <ActivityStrip data={rule.activity} />
        </td>
        <td className="rules-muted-col rules-col-run" title="Last detection run">
          {formatLastMatch(rule.lastMatch)}
        </td>
        <td className="rules-state-col">
          <div className="rules-state-stack">
            <span className={`badge badge-${rule.lifecycle} rules-state-badge`}>{rule.lifecycle}</span>
            <span
              className={`rules-mode-pill rules-mode-pill--${rule.raw.mode}`}
              title={rule.mode}
            >
              {rule.raw.mode === "realtime" ? (
                <>
                  <Zap size={10} aria-hidden />
                  RT
                </>
              ) : (
                <>
                  <Clock size={10} aria-hidden />
                  Cron
                </>
              )}
            </span>
            {!enabled && <span className="badge rules-state-off">off</span>}
          </div>
        </td>
        <td className="rules-actions-col">
          <div className="rules-row-actions">
            <ShareShortLink id={rule.id} kind="rule" variant="icon" />
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rules-menu-btn" aria-label="Actions">
                <MoreVertical className="icon" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="icon" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onValidate}>
                <ShieldCheck className="icon" /> Preview
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRun} disabled={running}>
                <Play className="icon" /> Run now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleEnabled}>
                {enabled ? "Disable" : "Enable"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onMute}>Mute 1h</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-[var(--destructive)]">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="rules-row-expanded">
          <td colSpan={RULE_TABLE_COLUMN_COUNT}>
            <pre className="mono rules-query-preview">{rule.query}</pre>
            <RuleRowPreview
              ruleId={rule.id}
              query={rule.query}
              mode={rule.mode}
              minHits={rule.raw.min_hits}
              maxAlerts={rule.raw.max_alerts_per_run}
              active={expanded}
            />
            <div className="rules-row-expanded-actions">
              <button type="button" className="btn btn-ghost" onClick={onEdit}>
                Edit rule
              </button>
              <button type="button" className="btn btn-ghost" onClick={onValidate}>
                Preview in editor
              </button>
              <button type="button" className="btn btn-ghost" onClick={onRun} disabled={running}>
                {running ? "Running…" : "Run now"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
