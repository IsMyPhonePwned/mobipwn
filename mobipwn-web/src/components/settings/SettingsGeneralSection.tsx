import { useCallback, useEffect, useMemo, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { hasPermission } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsEntityLimitsSection } from "@/components/settings/SettingsEntityLimitsSection";
import { SettingsIngestPoolSection } from "@/components/settings/SettingsIngestPoolSection";
import { SettingsInstallEnrichmentSection } from "@/components/settings/SettingsInstallEnrichmentSection";
import { SettingsIosPublicCollectSection } from "@/components/settings/SettingsIosPublicCollectSection";
import { SettingsRetentionSection } from "@/components/settings/SettingsRetentionSection";
import { SettingsSearchLimitsSection } from "@/components/settings/SettingsSearchLimitsSection";
import { SettingsSysdiagnoseIngestSection } from "@/components/settings/SettingsSysdiagnoseIngestSection";

type Suppression = {
  id: string;
  name: string;
  rule_id: string | null;
  starts_at: string;
  ends_at: string;
};

type Rule = { id: string; name: string };

function fromLocalInput(value: string) {
  return new Date(value).toISOString();
}

function formatWindow(iso: string) {
  return iso.slice(0, 16).replace("T", " ");
}

type JumpId =
  | "settings-general-ingest"
  | "settings-general-search"
  | "settings-general-entities"
  | "settings-general-retention"
  | "settings-general-ios"
  | "settings-general-enrichment"
  | "settings-general-maintenance";

export function SettingsGeneralSection() {
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canManageSettings = hasPermission(user, "settings_write");
  const canManageSuppressions = hasPermission(user, "notifications_write");

  const [msg, setMsg] = useState("");
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [supName, setSupName] = useState("");
  const [supRuleId, setSupRuleId] = useState("");
  const [supStart, setSupStart] = useState("");
  const [supEnd, setSupEnd] = useState("");

  const loadSuppressions = useCallback(async () => {
    const res = await fetch("/api/v1/suppressions");
    if (res.ok) setSuppressions(await res.json());
  }, []);

  useEffect(() => {
    if (canManageSuppressions) {
      void loadSuppressions();
      fetch("/api/v1/rules")
        .then((r) => r.json())
        .then((list: Rule[]) => setRules(list))
        .catch(() => {});
    }
  }, [canManageSuppressions, loadSuppressions]);

  const addSuppression = async () => {
    if (!supName.trim() || !supStart || !supEnd) {
      setMsg("Name, start, and end are required.");
      return;
    }
    if (new Date(supEnd).getTime() <= new Date(supStart).getTime()) {
      setMsg("End must be after start.");
      return;
    }
    const res = await fetch("/api/v1/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: supName.trim(),
        rule_id: supRuleId || null,
        starts_at: fromLocalInput(supStart),
        ends_at: fromLocalInput(supEnd),
      }),
    });
    if (!res.ok) {
      setMsg(await res.text());
      return;
    }
    setSupName("");
    setSupRuleId("");
    setSupStart("");
    setSupEnd("");
    log("info", `Create maintenance window: ${supName.trim()}`);
    setMsg("Maintenance window created.");
    void loadSuppressions();
  };

  const removeSuppression = async (id: string) => {
    const res = await fetch(`/api/v1/suppressions/${id}`, { method: "DELETE" });
    if (!res.ok) setMsg(`Delete failed (${res.status})`);
    else {
      log("info", "Delete maintenance window", id);
      setMsg("Maintenance window removed.");
      void loadSuppressions();
    }
  };

  const ruleLabel = (ruleId: string | null) => {
    if (!ruleId) return "All rules";
    return rules.find((r) => r.id === ruleId)?.name ?? ruleId.slice(0, 8);
  };

  const now = Date.now();
  const windowStatus = (s: Suppression): "active" | "scheduled" | "ended" => {
    const start = new Date(s.starts_at).getTime();
    const end = new Date(s.ends_at).getTime();
    if (start <= now && end > now) return "active";
    if (start > now) return "scheduled";
    return "ended";
  };

  const jumps = useMemo(() => {
    const items: { id: JumpId; label: string }[] = [];
    if (canManageSettings) {
      items.push(
        { id: "settings-general-ingest", label: "Ingest" },
        { id: "settings-general-search", label: "Search" },
        { id: "settings-general-entities", label: "Entities" },
        { id: "settings-general-retention", label: "Retention" },
        { id: "settings-general-ios", label: "iOS" },
        { id: "settings-general-enrichment", label: "Enrichment" },
      );
    }
    if (canManageSuppressions) {
      items.push({ id: "settings-general-maintenance", label: "Maintenance" });
    }
    return items;
  }, [canManageSettings, canManageSuppressions]);

  if (!canManageSettings && !canManageSuppressions) {
    return (
      <section className="settings-panel card editor">
        <p className="muted text-sm">You don&apos;t have permission to change platform settings.</p>
      </section>
    );
  }

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>General</h2>
        <p className="muted text-sm">
          Platform ops: ingest capacity, search admission, retention, iOS parsers, and alert
          maintenance windows.
        </p>
      </header>

      {jumps.length > 1 && (
        <nav className="settings-jump-nav" aria-label="General subsections">
          {jumps.map((j) => (
            <a key={j.id} className="settings-jump-nav__link" href={`#${j.id}`}>
              {j.label}
            </a>
          ))}
        </nav>
      )}

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      {canManageSettings && (
        <>
          <div id="settings-general-ingest">
            <SettingsIngestPoolSection onMessage={setMsg} />
          </div>
          <SettingsSearchLimitsSection onMessage={setMsg} />
          <div id="settings-general-entities">
            <SettingsEntityLimitsSection onMessage={setMsg} />
          </div>
          <SettingsRetentionSection onMessage={setMsg} />
          <div id="settings-general-ios">
            <SettingsIosPublicCollectSection onMessage={setMsg} />
            <SettingsSysdiagnoseIngestSection onMessage={setMsg} />
          </div>
          <div id="settings-general-enrichment">
            <SettingsInstallEnrichmentSection onMessage={setMsg} />
          </div>
        </>
      )}

      {canManageSuppressions && (
        <div className="settings-panel__block" id="settings-general-maintenance">
          <h3 className="settings-panel__subhead">Maintenance windows</h3>
          <p className="muted text-xs">
            Pause new alerts and webhooks during planned work. Leave rule empty to suppress all
            detections.
          </p>

          <div className="settings-maintenance-form">
            <label className="settings-field">
              <span className="settings-field__label">Name</span>
              <input
                placeholder="e.g. Weekend rule mute"
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">Scope</span>
              <select value={supRuleId} onChange={(e) => setSupRuleId(e.target.value)}>
                <option value="">All rules</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field__label">Start</span>
              <input
                type="datetime-local"
                value={supStart}
                onChange={(e) => setSupStart(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field__label">End</span>
              <input
                type="datetime-local"
                value={supEnd}
                onChange={(e) => setSupEnd(e.target.value)}
              />
            </label>
            <div className="settings-maintenance-form__action">
              <button type="button" className="btn btn-primary" onClick={() => void addSuppression()}>
                Add window
              </button>
            </div>
          </div>

          {suppressions.length === 0 ? (
            <p className="muted text-xs settings-empty-hint">No maintenance windows scheduled.</p>
          ) : (
            <table className="data-table settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppressions.map((s) => {
                  const status = windowStatus(s);
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{ruleLabel(s.rule_id)}</td>
                      <td className="mono text-xs">
                        {formatWindow(s.starts_at)} → {formatWindow(s.ends_at)}
                      </td>
                      <td>
                        <span
                          className={`settings-status-badge settings-status-badge--${status}`}
                        >
                          {status === "active"
                            ? "Active"
                            : status === "scheduled"
                              ? "Scheduled"
                              : "Ended"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void removeSuppression(s.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
