import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlignLeft, ChevronDown, ChevronUp, History, Maximize2, Minimize2, Minus, Wand2, X } from "lucide-react";
import { ShareShortLink } from "@/components/ShareShortLink";
import { Button } from "@/components/ui/button";
import { MplQueryEditor } from "@/components/editor/MplQueryEditor";
import { useAuth } from "@/contexts/AuthContext";
import { listUserDirectory } from "@/lib/auth";
import { compactMplQuery, formatMplQuery } from "@/lib/mplFormat";
import { RuleQueryPreview } from "./RuleQueryPreview";
import { RuleQueryStructure } from "./RuleQueryStructure";
import { RuleEditorHeaderBadges, RuleEditorMetaForm } from "./RuleEditorMetaForm";
import { RuleVersionHistory } from "./RuleVersionHistory";
import { severityKey } from "./ruleEditorMeta";
import { SEV_META } from "./helpers";
import type { Rule } from "./helpers";
import { RuleSandboxPanel } from "./RuleSandboxPanel";
import { RuleRunDialog } from "./RuleRunDialog";
import type { RuleFolder, RuleRepository } from "./ruleOrg";

export type Validation = {
  sql: string;
  filter_sql: string;
  explain: string[];
  cost_tier: string;
  cost_reason: string;
  row_count: number;
  sample_rows: Record<string, unknown>[];
  realtime_compatible: boolean;
  elapsed_ms?: number;
  time_from?: string | null;
  time_to?: string | null;
};

export type DetectionRun = {
  id: string;
  started_at: string;
  duration_ms: number | null;
  hit_count: number;
  alerts_created: number;
  error: string | null;
};

export type RuleVersion = {
  version: number;
  author: string;
  query: string;
  query_before?: string | null;
  diff?: string | null;
  created_at: string;
};

type Props = {
  editing: Rule;
  setEditing: (r: Rule) => void;
  mitreText: string;
  setMitreText: (s: string) => void;
  tagsText: string;
  setTagsText: (s: string) => void;
  repositories: RuleRepository[];
  folders: RuleFolder[];
  preview: Validation | null;
  previewQuery: string | null;
  previewLoading: boolean;
  previewError: string;
  runs: DetectionRun[];
  versions: RuleVersion[];
  running: boolean;
  loading: boolean;
  error: string;
  isNew: boolean;
  collapsed: boolean;
  fullscreen: boolean;
  onResizeStart: (clientY: number) => void;
  onToggleCollapsed: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSave: () => void;
  onPreview: () => void;
  onRun: () => void;
  runDialogOpen?: boolean;
  onRunDialogClose?: () => void;
  onRunDryRun?: () => void;
  onRunWithAlerts?: () => void;
  onSaveBeforeRun?: () => Promise<string | null>;
};

export function RuleEditorPanel({
  editing,
  setEditing,
  mitreText,
  setMitreText,
  tagsText,
  setTagsText,
  repositories,
  folders,
  preview,
  previewQuery,
  previewLoading,
  previewError,
  runs,
  versions,
  running,
  loading,
  error,
  isNew,
  collapsed,
  fullscreen,
  onResizeStart,
  onToggleCollapsed,
  onToggleFullscreen,
  onClose,
  onSave,
  onPreview,
  onRun,
  runDialogOpen,
  onRunDialogClose,
  onRunDryRun,
  onRunWithAlerts,
  onSaveBeforeRun,
}: Props) {
  const { user } = useAuth();
  const [directoryUsers, setDirectoryUsers] = useState<{ id: string; username: string }[]>([]);

  useEffect(() => {
    void listUserDirectory()
      .then(setDirectoryUsers)
      .catch(() => setDirectoryUsers([]));
  }, []);

  return (
    <>
    <section
      className={`rules-editor-dock${collapsed ? " rules-editor-dock--collapsed" : ""}${
        fullscreen ? " rules-editor-dock--fullscreen" : ""
      }`}
      data-severity={severityKey(editing.severity)}
      style={
        {
          "--rules-editor-severity": SEV_META[severityKey(editing.severity)].color,
        } as React.CSSProperties
      }
      aria-label="Rule editor"
    >
      {!collapsed && !fullscreen && (
        <div
          className="rules-editor-dock-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor — drag to give more room to the table or editor"
          onMouseDown={(e) => onResizeStart(e.clientY)}
        />
      )}

      <div className="rules-editor-dock-header">
        <div className="rules-editor-dock-head-main">
          <div className="rules-editor-dock-title">
            <h2 className="rules-editor-title">{isNew ? "New rule" : editing.name || "Edit rule"}</h2>
            <RuleEditorHeaderBadges editing={editing} />
          </div>
          {!collapsed && !isNew && editing.id ? (
            <ShareShortLink id={editing.id} kind="rule" variant="bar" />
          ) : null}
        </div>
        <div className="rules-editor-dock-toolbar">
          <Button size="sm" onClick={onSave} disabled={loading}>
            Save
          </Button>
          <Button size="sm" variant="secondary" disabled={previewLoading || loading} onClick={onPreview}>
            {previewLoading ? "Previewing…" : "Preview"}
          </Button>
          <Button size="sm" variant="secondary" disabled={running || loading} onClick={onRun}>
            {running ? "Running…" : "Run now"}
          </Button>
          <button
            type="button"
            className="rules-editor-icon-btn"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen editor" : "Fullscreen editor"}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen editor"}
          >
            {fullscreen ? <Minimize2 className="icon" /> : <Maximize2 className="icon" />}
          </button>
          <button
            type="button"
            className="rules-editor-icon-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand editor" : "Collapse editor"}
          >
            {collapsed ? <ChevronUp className="icon" /> : <ChevronDown className="icon" />}
          </button>
          <button type="button" className="rules-editor-icon-btn" onClick={onClose} aria-label="Close editor">
            <X className="icon" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="rules-editor-dock-body">
          {loading ? (
            <p className="muted rules-editor-loading">Loading rule…</p>
          ) : (
            <div className="rules-editor-workspace">
              <div className="rules-editor-query-banner">
                <div className="rules-editor-query-head">
                  <div className="rules-editor-query-meta">
                    <div className="rules-editor-query-label">
                      <span className="rules-editor-query-label-main">
                        <AlignLeft size={15} aria-hidden />
                        Query (mPL)
                      </span>
                      <Link to="/search/mpl" className="rules-editor-query-guide" target="_blank" rel="noreferrer">
                        Language reference
                      </Link>
                    </div>
                    <RuleQueryStructure query={editing.query} />
                  </div>
                  <div className="rules-editor-query-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!editing.query.trim()}
                      onClick={() => setEditing({ ...editing, query: formatMplQuery(editing.query) })}
                      title="Format query — one stage per line"
                    >
                      <Wand2 size={14} aria-hidden />
                      Format
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!editing.query.trim()}
                      onClick={() => setEditing({ ...editing, query: compactMplQuery(editing.query) })}
                      title="Compact query to a single line"
                    >
                      <Minus size={14} aria-hidden />
                      Compact
                    </Button>
                  </div>
                </div>
                <MplQueryEditor
                  value={editing.query}
                  onChange={(q) => setEditing({ ...editing, query: q })}
                  minHeight={fullscreen ? 420 : 340}
                />
              </div>

              <div className="rules-editor-workspace-panels">
              <div className="rules-editor-form-col">
                {error && <p className="error rules-editor-error">{error}</p>}

                <RuleEditorMetaForm
                  editing={editing}
                  setEditing={setEditing}
                  mitreText={mitreText}
                  setMitreText={setMitreText}
                  tagsText={tagsText}
                  setTagsText={setTagsText}
                  repositories={repositories}
                  folders={folders}
                  directoryUsers={directoryUsers}
                  currentUsername={user?.username}
                />

                {(runs.length > 0 || versions.length > 0) && (
                  <details className="rules-editor-meta rules-editor-history">
                    <summary className="rules-editor-history__summary">
                      <History className="icon accent" />
                      <span>History</span>
                      <span className="rules-editor-history__counts muted">
                        {versions.length > 0 && `${versions.length} version${versions.length === 1 ? "" : "s"}`}
                        {versions.length > 0 && runs.length > 0 && " · "}
                        {runs.length > 0 && `${runs.length} run${runs.length === 1 ? "" : "s"}`}
                      </span>
                    </summary>
                    <div className="rules-editor-history__body">
                      {versions.length > 0 && (
                        <RuleVersionHistory
                          versions={versions}
                          currentQuery={editing.query}
                          onRestoreQuery={(query) => setEditing({ ...editing, query })}
                        />
                      )}
                      {runs.length > 0 && (
                        <section className="rules-editor-runs">
                          <h4 className="rules-editor-runs__title">Detection runs</h4>
                          <table className="data-table rules-editor-runs-table">
                            <thead>
                              <tr>
                                <th>Started</th>
                                <th>Hits</th>
                                <th>Alerts</th>
                                <th>Duration</th>
                              </tr>
                            </thead>
                            <tbody>
                              {runs.slice(0, 6).map((run) => (
                                <tr key={run.id}>
                                  <td>{run.started_at.slice(0, 16)}</td>
                                  <td>{run.hit_count}</td>
                                  <td>{run.alerts_created}</td>
                                  <td className="muted">
                                    {run.duration_ms != null ? `${run.duration_ms}ms` : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      )}
                    </div>
                  </details>
                )}
              </div>

              <div className="rules-editor-preview-col">
                <RuleSandboxPanel
                  ruleId={editing.id || null}
                  query={editing.query}
                  mode={editing.mode}
                  onSaveBeforeRun={onSaveBeforeRun}
                  onPreviewQuery={onPreview}
                  previewLoading={previewLoading}
                />
                <RuleQueryPreview
                  preview={preview}
                  loading={previewLoading}
                  error={previewError}
                  query={editing.query}
                  previewQuery={previewQuery}
                  minHits={editing.min_hits ?? 1}
                  maxAlerts={editing.max_alerts_per_run ?? 50}
                  onRefresh={onPreview}
                />
              </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
    <RuleRunDialog
      open={Boolean(runDialogOpen)}
      ruleName={editing.name}
      busy={running}
      onClose={() => onRunDialogClose?.()}
      onDryRun={() => onRunDryRun?.()}
      onCreateAlerts={() => onRunWithAlerts?.()}
    />
    </>
  );
}
