import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Database, Download, PanelLeft, Plus, RefreshCw, Search as SearchIcon, ShieldAlert, User } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { BandHeader } from "@/components/rules/BandHeader";
import { BulkActionBar } from "@/components/rules/BulkActionBar";
import {
  BANDS,
  bandOf,
  buildRuleView,
  type BandId,
  RULE_TABLE_COLUMN_COUNT,
  type Rule,
  type RuleRunSummary,
} from "@/components/rules/helpers";
import { RuleCheckbox } from "@/components/rules/RuleCheckbox";
import { RuleRow } from "@/components/rules/RuleRow";
import { RulesOverview, type FleetHealth, type VelocityBucket } from "@/components/rules/RulesOverview";
import { FilterSelect, SegmentedSev, type SevFilter } from "@/components/rules/RulesToolbarChips";
import { TacticChips } from "@/components/rules/TacticChips";
import { RuleEditorPanel } from "@/components/rules/RuleEditorPanel";
import { MitreCoverageMap } from "@/components/rules/MitreCoverageMap";
import { executeRuleRun, formatRuleRunMessage } from "@/lib/ruleRun";
import { RuleRunDialog } from "@/components/rules/RuleRunDialog";
import { ruleMatchesTactic } from "@/components/rules/tactics";
import { useRuleEditor } from "@/components/rules/useRuleEditor";
import { useDockSplit } from "@/components/rules/useDockSplit";
import { RulesOrgSidebar } from "@/components/rules/RulesOrgSidebar";
import type { OrgFilter, RuleOrgBundle } from "@/components/rules/ruleOrg";
import { PageHeader } from "@/components/ui/PageHeader";
import { CompactDataTable } from "@/components/ui/CompactDataTable";
import { useLocale } from "@/contexts/LocaleContext";
import { cn } from "@/lib/utils";

type ModeFilter = "all" | "scheduled" | "realtime";
type StatusFilter = "all" | "live" | "staging" | "disabled";

export default function DetectionsPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const mine = searchParams.get("mine") === "1";
  const editId = searchParams.get("edit");
  const isNewEditor = searchParams.get("new") === "1";
  const editorOpen = isNewEditor || !!editId;
  const tableRef = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [summaries, setSummaries] = useState<Record<string, RuleRunSummary>>({});
  const [fleetHealth, setFleetHealth] = useState<FleetHealth | null>(null);
  const [velocity, setVelocity] = useState<VelocityBucket[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runDialog, setRunDialog] = useState<{ ruleId: string; ruleName: string } | null>(null);
  const [sigmaYaml, setSigmaYaml] = useState("");
  const [sigmaOpen, setSigmaOpen] = useState(false);
  const [orgBundle, setOrgBundle] = useState<RuleOrgBundle | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgFilter, setOrgFilter] = useState<OrgFilter>({
    repositoryId: null,
    folderId: null,
    tag: null,
  });

  const [sev, setSev] = useState<SevFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tactic, setTactic] = useState("All tactics");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openBands, setOpenBands] = useState<Record<BandId, boolean>>(() => {
    const m = {} as Record<BandId, boolean>;
    BANDS.forEach((b) => {
      m[b.id] = b.defaultOpen;
    });
    return m;
  });
  const [librariesOpen, setLibrariesOpen] = useState(() => {
    try {
      return localStorage.getItem("mobipwn-rules-libraries-open") !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("mobipwn-rules-libraries-open", librariesOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [librariesOpen]);

  const loadOrg = useCallback(async () => {
    setOrgLoading(true);
    try {
      const res = await fetch("/api/v1/rule-org");
      if (res.ok) setOrgBundle(await res.json());
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const setMine = useCallback(
    (on: boolean) => {
      const next = new URLSearchParams(searchParams);
      if (on) next.set("mine", "1");
      else next.delete("mine");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rulesUrl = mine && user ? "/api/v1/rules?maintainer=me" : "/api/v1/rules";
      const [rulesRes, sumRes, fleetRes, velRes] = await Promise.all([
        fetch(rulesUrl),
        fetch("/api/v1/rules/run-summary"),
        fetch("/api/v1/rules/fleet-health"),
        fetch("/api/v1/alerts/velocity?hours=24"),
      ]);
      const rulesData = await rulesRes.json();
      if (!rulesRes.ok) setError(JSON.stringify(rulesData));
      else setRules(rulesData);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        const map: Record<string, RuleRunSummary> = {};
        for (const [id, s] of Object.entries(sumData.summaries ?? {})) {
          map[id] = s as RuleRunSummary;
        }
        setSummaries(map);
      }

      if (fleetRes.ok) setFleetHealth(await fleetRes.json());
      if (velRes.ok) setVelocity(await velRes.json());
    } finally {
      setLoading(false);
    }
  }, [mine, user]);

  useEffect(() => {
    void load();
    void loadOrg();
  }, [load, loadOrg]);

  const closeEditor = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!editorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, closeEditor]);

  useEffect(() => {
    if (!editId) return;
    requestAnimationFrame(() => {
      tableRef.current?.querySelector("tr.rules-row.editing")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, [editId]);

  const openEditorForRule = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("edit", id);
      next.delete("new");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const dockSplit = useDockSplit(editorOpen);

  const editor = useRuleEditor(isNewEditor ? null : editId, isNewEditor, (saved) => {
    void load();
    void loadOrg();
    if (isNewEditor && saved.id) {
      const next = new URLSearchParams(searchParams);
      next.set("edit", saved.id);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  });

  const now = useMemo(() => new Date(), [rules, summaries]);

  const views = useMemo(
    () => rules.map((r) => buildRuleView(r, summaries[r.id])),
    [rules, summaries]
  );

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const r of rules) {
      for (const t of r.tags ?? []) tags.add(t);
    }
    return [...tags].sort();
  }, [rules]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return views.filter((v) => {
      if (orgFilter.repositoryId && v.raw.repository_id !== orgFilter.repositoryId) return false;
      if (orgFilter.folderId && v.raw.folder_id !== orgFilter.folderId) return false;
      if (orgFilter.tag && !(v.raw.tags ?? []).includes(orgFilter.tag)) return false;
      if (sev !== "all" && v.severity !== sev) return false;
      if (mode !== "all" && v.raw.mode !== mode) return false;
      if (status !== "all") {
        const b = bandOf(v.raw, summaries[v.id], now);
        if (status === "live" && !(v.lifecycle === "live" || v.lifecycle === "alerting")) return false;
        if (status === "staging" && v.lifecycle !== "staging") return false;
        if (status === "disabled" && b !== "disabled") return false;
      }
      if (!ruleMatchesTactic(v.raw.mitre, tactic)) return false;
      if (needle && !v.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [views, orgFilter, sev, mode, status, tactic, search, summaries, now]);

  const createFolder = useCallback(
    async (repositoryId: string, name: string) => {
      const res = await fetch("/api/v1/rule-org/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository_id: repositoryId, name }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      await loadOrg();
    },
    [loadOrg]
  );

  const createRepository = useCallback(
    async (name: string) => {
      const res = await fetch("/api/v1/rule-org/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      await loadOrg();
    },
    [loadOrg]
  );

  const grouped = useMemo(() => {
    const g: Record<BandId, typeof filtered> = {
      firing: [],
      active: [],
      silent: [],
      staging: [],
      disabled: [],
    };
    filtered.forEach((v) => {
      g[bandOf(v.raw, summaries[v.id], now)].push(v);
    });
    return g;
  }, [filtered, summaries, now]);

  const firingCount = rules.filter((r) => bandOf(r, summaries[r.id], now) === "firing").length;
  const silentCount = rules.filter((r) => bandOf(r, summaries[r.id], now) === "silent").length;
  const alerts24h = useMemo(() => velocity.reduce((n, b) => n + b.count, 0), [velocity]);

  const reviewSilent = () => {
    setOpenBands((o) => ({ ...o, silent: true }));
    requestAnimationFrame(() => {
      tableRef.current?.querySelector('[data-band="silent"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openEdit = (r: Rule) => {
    log("info", `Edit rule: ${r.name}`);
    if (r.id) openEditorForRule(r.id);
    else {
      const next = new URLSearchParams(searchParams);
      next.set("new", "1");
      next.delete("edit");
      setSearchParams(next, { replace: true });
    }
  };

  const openNew = () => {
    log("info", "New detection rule");
    const next = new URLSearchParams(searchParams);
    next.set("new", "1");
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const validate = (id: string) => {
    const name = rules.find((r) => r.id === id)?.name ?? id;
    log("info", `Open rule preview: ${name}`);
    openEditorForRule(id);
  };

  const importSigma = async () => {
    if (!sigmaYaml.trim()) return;
    log("info", "Import Sigma YAML");
    const res = await fetch("/api/v1/rules/import-sigma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: sigmaYaml, author: "web" }),
    });
    const data = await res.json();
    if (!res.ok) setError(JSON.stringify(data));
    else {
      setSigmaYaml("");
      setSigmaOpen(false);
      if (data.warnings?.length) setError(data.warnings.join("; "));
      await load();
      if (data.rule?.id) openEditorForRule(data.rule.id);
    }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    const res = await fetch(`/api/v1/rules/${id}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) setError(await res.text());
    else await load();
  };

  const mute = async (id: string, minutes: number | null) => {
    const res = await fetch(`/api/v1/rules/${id}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minutes ? { minutes } : { muted_until: null }),
    });
    if (!res.ok) setError(await res.text());
    else await load();
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm("Delete this rule permanently?")) return;
    const res = await fetch(`/api/v1/rules/${id}/delete`, { method: "POST" });
    if (!res.ok) setError(await res.text());
    else await load();
  };

  const bulkDelete = async () => {
    if (!selected.size || !window.confirm(`Delete ${selected.size} rule(s) permanently?`)) return;
    const res = await fetch("/api/v1/rules/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const data = await res.json();
    if (!res.ok) setError(JSON.stringify(data));
    else {
      setSelected(new Set());
      await load();
    }
  };

  const openRunDialog = (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    setRunDialog({ ruleId, ruleName: rule?.name ?? "Rule" });
  };

  const executeRun = async (createAlerts: boolean) => {
    if (!runDialog) return;
    const { ruleId } = runDialog;
    setRunDialog(null);
    setError("");
    setRunning(true);
    try {
      const data = await executeRuleRun(ruleId, { createAlerts });
      await load();
      const msg = formatRuleRunMessage(data, createAlerts);
      if (createAlerts && data.alerts_created > 0 && window.confirm(`${msg}\n\nOpen Alerts page?`)) {
        navigate("/alerts");
      } else {
        alert(msg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const bulkEnable = async (enabled: boolean) => {
    for (const id of selected) {
      await setEnabled(id, enabled);
    }
    setSelected(new Set());
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((v) => v.id)));
  };

  return (
    <div className={cn("rules-page", editorOpen && "rules-page--editing")}>
      <PageHeader
        title={t("rulesPage.title")}
        description={
          <span className="rules-page-meta">
            {t("rulesPage.metaTotal", { count: String(rules.length) })}
            <span> · </span>
            <strong>{t("rulesPage.metaFiring", { count: String(firingCount) })}</strong>
            <span> · </span>
            <span className="warn">{t("rulesPage.metaReview", { count: String(silentCount) })}</span>
          </span>
        }
        actions={
          <>
            {user && (
              <Button variant={mine ? "default" : "secondary"} size="sm" onClick={() => setMine(!mine)}>
                <User className="icon" />
                {t("rulesPage.myRules")}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setSigmaOpen(true)}>
              <Download className="icon" />
              {t("rulesPage.import")}
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/rules/repositories">
                <Database className="icon" />
                {t("rulesPage.repositories")}
              </Link>
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="icon" />
              {t("rulesPage.newRule")}
            </Button>
          </>
        }
      />

      {error && <p className="error">{error}</p>}

      {mine && user && (
        <p className="rules-mine-banner">
          Showing rules you maintain as <strong>{user.username}</strong>.
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMine(false)}>
            Show all rules
          </button>
        </p>
      )}

      {!editorOpen && (
        <RulesOverview
          rules={rules}
          summaries={summaries}
          silentCount={silentCount}
          alerts24h={alerts24h}
          fleetHealth={fleetHealth}
          velocity={velocity}
          onReviewSilent={reviewSilent}
        />
      )}

      {!editorOpen && (
        <MitreCoverageMap rules={rules} activeTactic={tactic} onSelectTactic={setTactic} />
      )}

      {!editorOpen && <TacticChips value={tactic} onChange={setTactic} />}

      <div
        className={cn(
          "rules-page-workspace",
          editorOpen && "rules-page-workspace--editing",
          !librariesOpen && "rules-page-workspace--libraries-collapsed"
        )}
      >
        {librariesOpen ? (
          <RulesOrgSidebar
            bundle={orgBundle}
            filter={orgFilter}
            allTags={allTags}
            totalRules={rules.length}
            loading={orgLoading}
            onFilterChange={setOrgFilter}
            onCreateFolder={createFolder}
            onCreateRepository={createRepository}
          />
        ) : null}

        <div
          className={cn(
            "rules-page-body",
            editorOpen && "rules-page-docked",
            editorOpen && dockSplit.fullscreen && "rules-page-docked--table-hidden"
          )}
          style={editorOpen ? { gridTemplateRows: dockSplit.gridRows } : undefined}
        >
          <div className="rules-page-main">
      <div className="rules-toolbar">
        <button
          type="button"
          className={cn("rules-libraries-toggle", librariesOpen && "rules-libraries-toggle--open")}
          onClick={() => setLibrariesOpen((v) => !v)}
          aria-pressed={librariesOpen}
          title={librariesOpen ? "Hide libraries" : "Show libraries"}
        >
          <PanelLeft size={14} aria-hidden />
          <span className="rules-libraries-toggle__label">Libraries</span>
        </button>
        <div className="rules-search-wrap">
          <SearchIcon className="rules-search-icon" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules…"
            className="rules-search-input"
            aria-label="Search rules"
          />
        </div>
        <div className="rules-toolbar-filters">
          <SegmentedSev value={sev} onChange={setSev} />
          <FilterSelect
            label="Mode:"
            value={mode}
            onChange={setMode}
            options={[
              { id: "all", label: "All" },
              { id: "scheduled", label: "Scheduled" },
              { id: "realtime", label: "Real-time" },
            ]}
          />
          <FilterSelect
            label="Status:"
            value={status}
            onChange={setStatus}
            options={[
              { id: "all", label: "All" },
              { id: "live", label: "Live" },
              { id: "staging", label: "Staging" },
              { id: "disabled", label: "Disabled" },
            ]}
          />
        </div>
        <span className="rules-toolbar-count">
          {filtered.length} of {rules.length}
        </span>
        <button
          type="button"
          className="rules-refresh-btn"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh rules"
        >
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="rules-table-wrap" ref={tableRef}>
        <table className="rules-table">
          <colgroup>
            <col className="rules-col-sev" />
            <col className="rules-col-chk" />
            <col className="rules-col-exp" />
            <col className="rules-col-hits" />
            <col className="rules-col-name" />
            <col className="rules-col-trend" />
            <col className="rules-col-run" />
            <col className="rules-col-state" />
            <col className="rules-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="rules-sev-bar" aria-label="Severity" />
              <th className="rules-col-chk">
                <RuleCheckbox
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  indeterminate={selected.size > 0 && selected.size < filtered.length}
                  onChange={toggleSelectAll}
                  ariaLabel="Select all"
                />
              </th>
              <th className="rules-col-exp" aria-label="Expand" />
              <th className="rules-th-num rules-col-hits" title="Hits in the last 24 hours">
                24h
              </th>
              <th className="rules-col-name">Rule</th>
              <th className="rules-col-trend" title="Activity in the last 28 days">
                28d
              </th>
              <th className="rules-col-run" title="Last detection run">
                Run
              </th>
              <th className="rules-col-state" title="Lifecycle and mode">
                State
              </th>
              <th className="rules-col-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {BANDS.map((band) => {
              const items = grouped[band.id];
              if (!items.length) return null;
              const open = openBands[band.id];
              return (
                <BandGroup
                  key={band.id}
                  band={band}
                  items={items}
                  open={open}
                  onToggle={() => setOpenBands((o) => ({ ...o, [band.id]: !o[band.id] }))}
                  expandedId={expandedId}
                  selected={selected}
                  running={running}
                  onToggleExpand={(id) => setExpandedId((v) => (v === id ? null : id))}
                  onToggleSelect={(id) => {
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    });
                  }}
                  editingId={editId}
                  onEdit={(r) => openEdit(r.raw)}
                  onValidate={(id) => void validate(id)}
                  onRun={(id) => openRunDialog(id)}
                  onToggleEnabled={(r) => void setEnabled(r.id, r.raw.enabled === false)}
                  onMute={(id) => void mute(id, 60)}
                  onDelete={(id) => void deleteRule(id)}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={RULE_TABLE_COLUMN_COUNT} className="rules-empty">
                  <ShieldAlert className="rules-empty-icon" />
                  <div>No rules match your filters</div>
                  <p className="rules-empty-hint">Try a different severity, mode, tactic — or clear your search.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!editorOpen && (
        <footer className="rules-footer">
          <span>
            Showing {filtered.length} of {rules.length} rules
          </span>
          <button type="button" className="rules-footer-hint" onClick={openNew}>
            New rule
          </button>
        </footer>
      )}
          </div>

          {editorOpen && (
          <RuleEditorPanel
            editing={editor.editing}
            setEditing={editor.setEditing}
            mitreText={editor.mitreText}
            setMitreText={editor.setMitreText}
            tagsText={editor.tagsText}
            setTagsText={editor.setTagsText}
            repositories={orgBundle?.repositories ?? []}
            folders={orgBundle?.folders ?? []}
            preview={editor.preview}
            previewQuery={editor.previewQuery}
            previewLoading={editor.previewLoading}
            previewError={editor.previewError}
            runs={editor.runs}
            versions={editor.versions}
            running={editor.running}
            loading={editor.loading}
            error={editor.error}
            isNew={isNewEditor && !editor.editing.id}
            collapsed={dockSplit.collapsed}
            fullscreen={dockSplit.fullscreen}
            onResizeStart={dockSplit.onResizeStart}
            onToggleCollapsed={dockSplit.toggleCollapsed}
            onToggleFullscreen={dockSplit.toggleFullscreen}
            onClose={closeEditor}
            onSave={() => void editor.save()}
            onPreview={() => editor.previewNow()}
            onRun={() => void editor.requestRunNow()}
            runDialogOpen={editor.runDialogOpen}
            onRunDialogClose={() => editor.setRunDialogOpen(false)}
            onRunDryRun={() => void editor.executeRunNow(false)}
            onRunWithAlerts={() => void editor.executeRunNow(true)}
            onSaveBeforeRun={async () => {
              const saved = await editor.save();
              return saved?.id ?? null;
            }}
          />
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          onEnable={() => void bulkEnable(true)}
          onDisable={() => void bulkEnable(false)}
          onDelete={() => void bulkDelete()}
          onClear={() => setSelected(new Set())}
        />
      )}

      <Sheet open={sigmaOpen} onOpenChange={setSigmaOpen}>
        <SheetContent side="right" className="rules-sigma-sheet">
          <h2 className="rules-sigma-sheet-title">Import Sigma YAML</h2>
          <p className="rules-sigma-sheet-sub">Paste a sigma-zero rule; it is imported as a staging rule.</p>
          <textarea
            placeholder="Paste sigma-zero rule YAML…"
            value={sigmaYaml}
            onChange={(e) => setSigmaYaml(e.target.value)}
            rows={14}
            className="mono rules-sigma-textarea"
          />
          <div className="rules-sigma-sheet-actions">
            <Button variant="secondary" size="sm" onClick={() => setSigmaOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void importSigma()} disabled={!sigmaYaml.trim()}>
              Import as staging
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <RuleRunDialog
        open={runDialog !== null}
        ruleName={runDialog?.ruleName}
        busy={running}
        onClose={() => setRunDialog(null)}
        onDryRun={() => void executeRun(false)}
        onCreateAlerts={() => void executeRun(true)}
      />
    </div>
  );
}

function BandGroup({
  band,
  items,
  open,
  onToggle,
  expandedId,
  selected,
  running,
  onToggleExpand,
  onToggleSelect,
  onEdit,
  onValidate,
  onRun,
  onToggleEnabled,
  onMute,
  onDelete,
  editingId,
}: {
  band: (typeof BANDS)[number];
  items: ReturnType<typeof buildRuleView>[];
  open: boolean;
  onToggle: () => void;
  expandedId: string | null;
  editingId: string | null;
  selected: Set<string>;
  running: boolean;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onEdit: (v: ReturnType<typeof buildRuleView>) => void;
  onValidate: (id: string) => void;
  onRun: (id: string) => void;
  onToggleEnabled: (v: ReturnType<typeof buildRuleView>) => void;
  onMute: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <BandHeader band={band} count={items.length} open={open} onToggle={onToggle} />
      {open &&
        items.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            expanded={expandedId === rule.id}
            editing={editingId === rule.id}
            selected={selected.has(rule.id)}
            onToggle={() => onToggleExpand(rule.id)}
            onSelect={() => onToggleSelect(rule.id)}
            onEdit={() => onEdit(rule)}
            onValidate={() => onValidate(rule.id)}
            onRun={() => onRun(rule.id)}
            onToggleEnabled={() => onToggleEnabled(rule)}
            onMute={() => onMute(rule.id)}
            onDelete={() => onDelete(rule.id)}
            running={running}
          />
        ))}
    </>
  );
}
