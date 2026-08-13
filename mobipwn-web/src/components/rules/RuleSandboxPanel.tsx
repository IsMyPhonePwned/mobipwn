import { useCallback, useEffect, useState } from "react";
import { Eye, FlaskConical, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { apiFetch, apiPost } from "@/lib/api";
import { executeRuleRun } from "@/lib/ruleRun";
import { withSandboxSource } from "@/lib/ruleSandbox";
import type { Validation } from "./RuleEditorPanel";
import { RuleQueryPreview } from "./RuleQueryPreview";

type SourceOption = { source: string; label: string; platform?: string };

type Props = {
  ruleId: string | null;
  query: string;
  mode: string;
  onSaveBeforeRun?: () => Promise<string | null>;
  /** Preview the full editor query (toolbar preview). */
  onPreviewQuery?: () => void;
  previewLoading?: boolean;
};

export function RuleSandboxPanel({
  ruleId,
  query,
  mode,
  onSaveBeforeRun,
  onPreviewQuery,
  previewLoading,
}: Props) {
  const { t } = useLocale();
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sandboxSource, setSandboxSource] = useState("");
  const [preview, setPreview] = useState<Validation | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<{ hits: number; alerts: number; ms: number } | null>(null);

  useEffect(() => {
    void apiFetch<{ total_events: number; sources: { source: string; platform: string; event_count: number }[] }>(
      "/v1/data/summary",
    )
      .then((d) => {
        setSources(
          (d.sources ?? [])
            .filter((s) => s.event_count > 0)
            .slice(0, 200)
            .map((s) => ({
              source: s.source,
              platform: s.platform,
              label: `${s.source} (${s.event_count.toLocaleString()} events)`,
            })),
        );
      })
      .catch(() => setSources([]));
  }, []);

  const scopedQuery = sandboxSource ? withSandboxSource(query, sandboxSource) : query;

  const runScopedPreview = useCallback(async () => {
    const text = scopedQuery.trim();
    if (!text) {
      setError(t("rulesPage.sandboxQueryRequired"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const path = ruleId ? `/api/v1/rules/${ruleId}/validate` : "/api/v1/rules/validate-query";
      const data = await apiPost<Validation>(path, { query: text, mode });
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, ruleId, scopedQuery, t]);

  const runDry = useCallback(async () => {
    setRunning(true);
    setError("");
    setLastRun(null);
    try {
      let id = ruleId;
      if (!id && onSaveBeforeRun) {
        id = await onSaveBeforeRun();
        if (!id) return;
      }
      if (!id) {
        setError(t("rulesPage.sandboxSaveFirst"));
        return;
      }
      const data = await executeRuleRun(id, {
        createAlerts: false,
        queryOverride: scopedQuery.trim() !== query.trim() ? scopedQuery : undefined,
      });
      setLastRun({ hits: data.hit_count, alerts: data.alerts_created, ms: data.duration_ms });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [onSaveBeforeRun, query, ruleId, scopedQuery, t]);

  return (
    <section className="rule-sandbox ops-panel ops-panel--teal">
      <header className="ops-panel__header">
        <div className="ops-panel__head-main">
          <span className="ops-panel__icon" aria-hidden>
            <FlaskConical size={15} />
          </span>
          <div className="ops-panel__titles">
            <h3 className="ops-panel__title">{t("rulesPage.sandboxTitle")}</h3>
            <p className="ops-panel__hint muted">{t("rulesPage.sandboxHint")}</p>
          </div>
        </div>
        <div className="ops-panel__actions rule-sandbox__actions">
          {onPreviewQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={previewLoading || !query.trim()}
              onClick={onPreviewQuery}
              title={t("rulesPage.sandboxPreviewFullHint")}
            >
              <Eye size={14} aria-hidden />
              {previewLoading ? t("rulesPage.sandboxPreviewing") : t("rulesPage.sandboxPreviewFull")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || !scopedQuery.trim()}
            onClick={() => void runScopedPreview()}
            title={t("rulesPage.sandboxPreviewScopedHint")}
          >
            <Search size={14} aria-hidden />
            {loading ? t("rulesPage.sandboxPreviewing") : t("rulesPage.sandboxPreviewScoped")}
          </Button>
          <Button type="button" size="sm" disabled={running || !query.trim()} onClick={() => void runDry()}>
            <Play size={14} aria-hidden />
            {running ? t("rulesPage.sandboxRunning") : t("rulesPage.sandboxDryRun")}
          </Button>
        </div>
      </header>
      <div className="rule-sandbox__body">
        <label className="rule-sandbox__source">
          <span className="rule-sandbox__source-label">{t("rulesPage.sandboxSourceLabel")}</span>
          <select value={sandboxSource} onChange={(e) => setSandboxSource(e.target.value)}>
            <option value="">{t("rulesPage.sandboxSourceAll")}</option>
            {sources.map((s) => (
              <option key={s.source} value={s.source}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {sandboxSource && scopedQuery !== query.trim() && (
          <p className="rule-sandbox__scoped mono muted text-xs">
            {t("rulesPage.sandboxScopedQuery")}: {scopedQuery}
          </p>
        )}
        {error && <p className="error text-sm">{error}</p>}
        {lastRun && (
          <p className="rule-sandbox__result muted text-sm">
            {t("rulesPage.sandboxDryRunResult", {
              hits: String(lastRun.hits),
              ms: String(lastRun.ms),
            })}
          </p>
        )}
        <RuleQueryPreview
          preview={preview}
          loading={loading}
          error=""
          query={scopedQuery}
          previewQuery={scopedQuery}
          onRefresh={() => void runScopedPreview()}
          compact
        />
      </div>
    </section>
  );
}
