import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { executeRuleRun, formatRuleRunMessage } from "@/lib/ruleRun";
import type { Rule } from "./helpers";
import { DEFAULT_RULE_REPO, formatTagsInput, parseTagsInput, UNCATEGORIZED_FOLDER } from "./ruleOrg";
import type { DetectionRun, RuleVersion } from "./RuleEditorPanel";
import { useRulePreview } from "./useRulePreview";

export const EMPTY_RULE: Rule = {
  id: "",
  name: "",
  query: 'source="case-001" process_name=* | head 50',
  lifecycle: "staging",
  mode: "scheduled",
  cron: "0 */6 * * *",
  severity: "medium",
  min_hits: 1,
  max_alerts_per_run: 50,
  repository_id: DEFAULT_RULE_REPO,
  folder_id: UNCATEGORIZED_FOLDER,
  tags: [],
};

export function useRuleEditor(
  ruleId: string | null,
  isNew: boolean,
  onSaved?: (rule: Rule) => void
) {
  const { log } = useActivityLog();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Rule>(EMPTY_RULE);
  const [mitreText, setMitreText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [runs, setRuns] = useState<DetectionRun[]>([]);
  const [editorReady, setEditorReady] = useState(isNew);

  const {
    preview,
    previewQuery,
    loading: previewLoading,
    error: previewError,
    runPreview,
    clearPreview,
  } = useRulePreview({
    ruleId: editing.id || ruleId,
    query: editing.query,
    mode: editing.mode,
    enabled: editorReady && !loading,
    autoDebounce: false,
  });

  useEffect(() => {
    if (isNew) {
      setEditing({
        ...EMPTY_RULE,
        maintainer: user?.username ?? null,
      });
      setMitreText("");
      setTagsText("");
      clearPreview();
      setVersions([]);
      setRuns([]);
      setError("");
      setLoading(false);
      setEditorReady(true);
      return;
    }
    if (!ruleId) return;

    setEditorReady(false);
    setLoading(true);
    setError("");
    clearPreview();
    fetch(`/api/v1/rules/${ruleId}`)
      .then((r) => r.json())
      .then((data: Rule) => {
        setEditing({
          ...data,
          min_hits: data.min_hits ?? 1,
          max_alerts_per_run: data.max_alerts_per_run ?? 50,
        });
        setMitreText((data.mitre ?? []).join(", "));
        setTagsText(formatTagsInput(data.tags));
        return Promise.all([
          fetch(`/api/v1/rules/${ruleId}/versions?limit=50`).then((r) => (r.ok ? r.json() : [])),
          fetch(`/api/v1/rules/${ruleId}/runs`).then((r) => (r.ok ? r.json() : [])),
        ]);
      })
      .then((extra) => {
        if (extra) {
          setVersions(extra[0] ?? []);
          setRuns(extra[1] ?? []);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        setLoading(false);
        setEditorReady(true);
      });
  }, [ruleId, isNew, clearPreview, user?.username]);

  const rulePayload = useCallback(
    (r: Rule) => ({
      name: r.name,
      query: r.query,
      lifecycle: r.lifecycle,
      mode: r.mode,
      cron: r.cron,
      severity: r.severity,
      min_hits: r.min_hits ?? 1,
      max_alerts_per_run: r.max_alerts_per_run ?? 50,
      prevalence_threshold: r.prevalence_threshold ?? null,
      mitre: mitreText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      maintainer: r.maintainer?.trim() || null,
      repository_id: r.repository_id ?? DEFAULT_RULE_REPO,
      folder_id: r.folder_id ?? UNCATEGORIZED_FOLDER,
      tags: parseTagsInput(tagsText),
    }),
    [mitreText, tagsText]
  );

  const save = useCallback(async (): Promise<Rule | null> => {
    const url = isNew || !editing.id ? "/api/v1/rules" : `/api/v1/rules/${editing.id}`;
    log("info", isNew || !editing.id ? "Create rule" : `Save rule ${editing.name}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rulePayload(editing)),
    });
    if (!res.ok) {
      setError(await res.text());
      return null;
    }
    const saved = (await res.json()) as Rule;
    setEditing(saved);
    if (saved.id) {
      const verRes = await fetch(`/api/v1/rules/${saved.id}/versions?limit=50`);
      if (verRes.ok) setVersions(await verRes.json());
    }
    onSaved?.(saved);
    return saved;
  }, [editing, isNew, log, onSaved, rulePayload]);

  const previewNow = useCallback(() => {
    if (!editing.query.trim()) {
      setError("Enter an mPL query to preview");
      return;
    }
    setError("");
    void runPreview(editing.query);
  }, [editing.query, runPreview]);

  const requestRunNow = useCallback(async () => {
    setError("");
    if (!editing.id) {
      const saved = await save();
      if (!saved) return;
    }
    setRunDialogOpen(true);
  }, [editing.id, save]);

  const executeRunNow = useCallback(
    async (createAlerts: boolean) => {
      setRunDialogOpen(false);
      setRunning(true);
      setError("");
      try {
        let ruleIdToRun = editing.id;
        if (!ruleIdToRun) {
          const saved = await save();
          if (!saved) return;
          ruleIdToRun = saved.id;
        }
        const data = await executeRuleRun(ruleIdToRun, { createAlerts });
        alert(formatRuleRunMessage(data, createAlerts));
        const runsRes = await fetch(`/api/v1/rules/${ruleIdToRun}/runs`);
        if (runsRes.ok) setRuns(await runsRes.json());
        onSaved?.(editing);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [editing, onSaved, save],
  );

  return {
    editing,
    setEditing,
    mitreText,
    setMitreText,
    tagsText,
    setTagsText,
    error,
    loading,
    running,
    runDialogOpen,
    setRunDialogOpen,
    preview,
    previewQuery,
    previewLoading,
    previewError,
    versions,
    runs,
    save,
    previewNow,
    requestRunNow,
    executeRunNow,
  };
}
