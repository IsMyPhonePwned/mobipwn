import {
  Bell,
  Clock,
  FolderTree,
  Shield,
  Target,
  UserRound,
  Zap,
} from "lucide-react";
import { AssigneePicker } from "@/components/alerts/AssigneePicker";
import { cn } from "@/lib/utils";
import { parseTagsInput, folderPathLabel } from "./ruleOrg";
import { RuleEditorField, RuleEditorSection } from "./RuleEditorSection";
import { SEV_META, type Rule } from "./helpers";
import {
  LIFECYCLE_META,
  MODE_META,
  severityBadgeClass,
  severityKey,
  type RuleLifecycle,
  type RuleMode,
} from "./ruleEditorMeta";
import type { RuleFolder, RuleRepository } from "./ruleOrg";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const LIFECYCLES: RuleLifecycle[] = ["staging", "live", "alerting"];
const MODES: RuleMode[] = ["scheduled", "realtime"];

type Props = {
  editing: Rule;
  setEditing: (r: Rule) => void;
  mitreText: string;
  setMitreText: (s: string) => void;
  tagsText: string;
  setTagsText: (s: string) => void;
  repositories: RuleRepository[];
  folders: RuleFolder[];
  directoryUsers: { id: string; username: string }[];
  currentUsername?: string | null;
};

export function RuleEditorMetaForm({
  editing,
  setEditing,
  mitreText,
  setMitreText,
  tagsText,
  setTagsText,
  repositories,
  folders,
  directoryUsers,
  currentUsername,
}: Props) {
  const tags = parseTagsInput(tagsText);
  const severity = severityKey(editing.severity);
  const lifecycle = (editing.lifecycle in LIFECYCLE_META ? editing.lifecycle : "staging") as RuleLifecycle;
  const mode = (editing.mode in MODE_META ? editing.mode : "scheduled") as RuleMode;

  return (
    <div className="rules-editor-meta-form">
      <RuleEditorSection theme="identity" icon={Shield} title="Identity" hint="How this rule appears in the fleet">
        <div className="rules-editor-identity-row">
          <RuleEditorField label="Rule name" wide>
            <input
              className="rules-editor-input rules-editor-input--name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Suspicious package install"
            />
          </RuleEditorField>
        </div>
        <div className="rules-editor-field rules-editor-field--card">
          <span className="rules-editor-field__label">Severity</span>
          <div className="rules-editor-pill-group rules-editor-pill-group--severity" role="group" aria-label="Severity">
            {SEVERITIES.map((s) => {
              const active = severity === s;
              return (
                <button
                  key={s}
                  type="button"
                  className={cn("rules-editor-pill", "rules-editor-pill--severity", active && "is-active")}
                  data-severity={s}
                  aria-pressed={active}
                  onClick={() => setEditing({ ...editing, severity: s })}
                >
                  {SEV_META[s].label}
                </button>
              );
            })}
          </div>
        </div>
      </RuleEditorSection>

      <RuleEditorSection theme="ownership" icon={UserRound} title="Ownership" hint="Who maintains and triages this rule">
        <div className="rules-editor-maintainer-card">
          <RuleEditorField label="Maintainer" wide>
            <AssigneePicker
              value={editing.maintainer ?? ""}
              onChange={(username) =>
                setEditing({ ...editing, maintainer: username.trim() || null })
              }
              users={directoryUsers}
              placeholder="Search users…"
            />
          </RuleEditorField>
          {editing.maintainer ? (
            <div className="rules-editor-maintainer-chip" title="Current maintainer">
              <UserRound size={13} aria-hidden />
              <span className="mono">{editing.maintainer}</span>
            </div>
          ) : (
            <p className="rules-editor-maintainer-empty muted text-xs">No maintainer assigned</p>
          )}
          {currentUsername && (editing.maintainer ?? "") !== currentUsername && (
            <button
              type="button"
              className="btn btn-ghost btn-sm rules-editor-assign-me"
              onClick={() => setEditing({ ...editing, maintainer: currentUsername })}
            >
              Assign to me
            </button>
          )}
        </div>
      </RuleEditorSection>

      <RuleEditorSection theme="organization" icon={FolderTree} title="Organization">
        <div className="rules-editor-grid rules-editor-grid--section">
          <RuleEditorField label="Repository">
            <select
              className="rules-editor-input"
              value={editing.repository_id ?? ""}
              onChange={(e) => {
                const repository_id = e.target.value || null;
                const repoFolders = folders.filter((f) => f.repository_id === repository_id);
                setEditing({
                  ...editing,
                  repository_id,
                  folder_id: repoFolders[0]?.id ?? null,
                });
              }}
            >
              <option value="">—</option>
              {repositories.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </RuleEditorField>
          <RuleEditorField label="Folder">
            <select
              className="rules-editor-input"
              value={editing.folder_id ?? ""}
              onChange={(e) => setEditing({ ...editing, folder_id: e.target.value || null })}
            >
              <option value="">—</option>
              {folders
                .filter((f) => !editing.repository_id || f.repository_id === editing.repository_id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPathLabel(folders, f.id)}
                  </option>
                ))}
            </select>
          </RuleEditorField>
          <RuleEditorField label="Tags" wide hint="Comma-separated labels">
            <input
              className="rules-editor-input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="mobile, investigation"
            />
            {tags.length > 0 && (
              <div className="rules-editor-tag-chips">
                {tags.map((tag) => (
                  <span key={tag} className="rules-editor-tag-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </RuleEditorField>
        </div>
      </RuleEditorSection>

      <RuleEditorSection theme="detection" icon={mode === "realtime" ? Zap : Clock} title="Detection" hint="When and how the rule runs">
        <div className="rules-editor-field rules-editor-field--card">
          <span className="rules-editor-field__label">Lifecycle</span>
          <div className="rules-editor-pill-group" role="group" aria-label="Lifecycle">
            {LIFECYCLES.map((l) => (
              <button
                key={l}
                type="button"
                className={cn("rules-editor-pill", "rules-editor-pill--lifecycle", lifecycle === l && "is-active")}
                data-lifecycle={l}
                aria-pressed={lifecycle === l}
                title={LIFECYCLE_META[l].hint}
                onClick={() => setEditing({ ...editing, lifecycle: l })}
              >
                {LIFECYCLE_META[l].label}
              </button>
            ))}
          </div>
        </div>
        <div className="rules-editor-field rules-editor-field--card">
          <span className="rules-editor-field__label">Mode</span>
          <div className="rules-editor-pill-group" role="group" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={cn("rules-editor-pill", "rules-editor-pill--mode", mode === m && "is-active")}
                data-mode={m}
                aria-pressed={mode === m}
                title={MODE_META[m].hint}
                onClick={() => setEditing({ ...editing, mode: m })}
              >
                {m === "realtime" ? (
                  <>
                    <Zap size={12} aria-hidden />
                    Realtime
                  </>
                ) : (
                  <>
                    <Clock size={12} aria-hidden />
                    Scheduled
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
        {mode === "scheduled" && (
          <RuleEditorField label="Cron schedule" hint="UTC cron expression">
            <input
              className="rules-editor-input mono"
              value={editing.cron ?? ""}
              onChange={(e) => setEditing({ ...editing, cron: e.target.value })}
              placeholder="0 */6 * * *"
            />
          </RuleEditorField>
        )}
      </RuleEditorSection>

      <RuleEditorSection theme="alerting" icon={Bell} title="Alerting thresholds" hint="Controls alert volume per run">
        <div className="rules-editor-grid rules-editor-grid--section rules-editor-grid--thresholds">
          <RuleEditorField label="Min hits" hint="Required matches to alert">
            <input
              className="rules-editor-input rules-editor-input--number"
              type="number"
              min={1}
              value={editing.min_hits ?? 1}
              onChange={(e) =>
                setEditing({ ...editing, min_hits: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </RuleEditorField>
          <RuleEditorField label="Max alerts" hint="Cap per detection run">
            <input
              className="rules-editor-input rules-editor-input--number"
              type="number"
              min={1}
              value={editing.max_alerts_per_run ?? 50}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  max_alerts_per_run: Math.max(1, Number(e.target.value) || 50),
                })
              }
            />
          </RuleEditorField>
        </div>
      </RuleEditorSection>

      <RuleEditorSection theme="mitre" icon={Target} title="MITRE ATT&CK" hint="Technique IDs for mapping and reporting">
        <RuleEditorField label="Techniques" wide hint="Comma-separated, e.g. T1059, T1071">
          <input
            className="rules-editor-input mono rules-editor-input--mitre"
            value={mitreText}
            onChange={(e) => setMitreText(e.target.value)}
            placeholder="T1059, T1071"
          />
          {mitreText.trim() && (
            <div className="rules-editor-mitre-chips">
              {mitreText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((id) => (
                  <span key={id} className="rules-editor-mitre-chip mono">
                    {id}
                  </span>
                ))}
            </div>
          )}
        </RuleEditorField>
      </RuleEditorSection>
    </div>
  );
}

export function RuleEditorHeaderBadges({ editing }: { editing: Rule }) {
  const severity = severityKey(editing.severity);
  const lifecycle = (editing.lifecycle in LIFECYCLE_META ? editing.lifecycle : "staging") as RuleLifecycle;
  const mode = (editing.mode in MODE_META ? editing.mode : "scheduled") as RuleMode;

  return (
    <div className="rules-editor-header-badges">
      <span className={`badge ${severityBadgeClass(editing.severity)}`}>{SEV_META[severity].label}</span>
      <span className={`badge ${LIFECYCLE_META[lifecycle].badge}`}>{LIFECYCLE_META[lifecycle].label}</span>
      <span className={`rules-editor-mode-badge rules-editor-mode-badge--${mode}`}>
        {mode === "realtime" ? <Zap size={11} aria-hidden /> : <Clock size={11} aria-hidden />}
        {MODE_META[mode].label}
      </span>
      {editing.maintainer ? (
        <span className="rules-editor-header-maintainer" title="Maintainer">
          <UserRound size={12} aria-hidden />
          <span className="mono">{editing.maintainer}</span>
        </span>
      ) : null}
    </div>
  );
}
