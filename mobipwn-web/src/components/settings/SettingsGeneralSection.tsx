import { useCallback, useEffect, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { hasPermission } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsEntityLimitsSection } from "@/components/settings/SettingsEntityLimitsSection";
import { SettingsInstallEnrichmentSection } from "@/components/settings/SettingsInstallEnrichmentSection";
import { SettingsIosPublicCollectSection } from "@/components/settings/SettingsIosPublicCollectSection";
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

export function SettingsGeneralSection() {
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canManageSettings = hasPermission(user, "settings_write");
  const canManageSuppressions = hasPermission(user, "notifications_write");

  const [retention, setRetention] = useState("{}");
  const [limits, setLimits] = useState("{}");
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
    if (canManageSettings) {
      fetch("/api/v1/settings/retention_by_source_type")
        .then((r) => r.json())
        .then((v) => setRetention(JSON.stringify(v, null, 2)))
        .catch(() => {});
      fetch("/api/v1/settings/search_limits")
        .then((r) => r.json())
        .then((v) => setLimits(JSON.stringify(v, null, 2)))
        .catch(() => {});
    }
    if (canManageSuppressions) {
      void loadSuppressions();
      fetch("/api/v1/rules")
        .then((r) => r.json())
        .then((list: Rule[]) => setRules(list))
        .catch(() => {});
    }
  }, [canManageSettings, canManageSuppressions, loadSuppressions]);

  const save = async (key: string, raw: string) => {
    log("info", `Save settings: ${key}`);
    try {
      const body = JSON.parse(raw);
      await fetch(`/api/v1/settings/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMsg(`Saved ${key.replace(/_/g, " ")}`);
    } catch (e) {
      setMsg(String(e));
      log("error", `Save settings failed: ${key}`, String(e));
    }
  };

  const addSuppression = async () => {
    if (!supName.trim() || !supStart || !supEnd) {
      setMsg("Name, start, and end are required.");
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
  const isActive = (s: Suppression) => {
    const start = new Date(s.starts_at).getTime();
    const end = new Date(s.ends_at).getTime();
    return start <= now && end > now;
  };

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
        <p className="muted text-sm">Retention, search limits, and maintenance windows.</p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      {canManageSuppressions && (
        <div className="settings-panel__block">
          <h3 className="settings-panel__subhead">Maintenance windows</h3>
          <p className="muted text-xs">
            Pause new alerts and webhooks during planned work. Leave rule empty to suppress all detections.
          </p>
          <div className="settings-inline-form">
            <input
              placeholder="Name"
              value={supName}
              onChange={(e) => setSupName(e.target.value)}
            />
            <select value={supRuleId} onChange={(e) => setSupRuleId(e.target.value)}>
              <option value="">All rules</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="settings-datetime">
              <span className="muted text-xs">Start</span>
              <input type="datetime-local" value={supStart} onChange={(e) => setSupStart(e.target.value)} />
            </label>
            <label className="settings-datetime">
              <span className="muted text-xs">End</span>
              <input type="datetime-local" value={supEnd} onChange={(e) => setSupEnd(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" onClick={() => void addSuppression()}>
              Add window
            </button>
          </div>
          {suppressions.length > 0 && (
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
                {suppressions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{ruleLabel(s.rule_id)}</td>
                    <td className="mono text-xs">
                      {s.starts_at.slice(0, 16).replace("T", " ")} → {s.ends_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td>{isActive(s) ? "Active" : "Scheduled / ended"}</td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => void removeSuppression(s.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {canManageSettings && (
        <>
          <div className="settings-panel__block">
            <h3 className="settings-panel__subhead">Data retention</h3>
            <p className="muted text-xs">
              Days per MUDM <code className="mono">source_type</code> — e.g.{" "}
              <code className="mono">{`{"android_bugreport": 90}`}</code>
            </p>
            <textarea rows={5} value={retention} onChange={(e) => setRetention(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={() => void save("retention_by_source_type", retention)}>
              Save retention
            </button>
          </div>

          <div className="settings-panel__block">
            <h3 className="settings-panel__subhead">Search limits</h3>
            <p className="muted text-xs">
              Query caps: <code className="mono">max_limit</code>, <code className="mono">max_query_len</code>,{" "}
              <code className="mono">default_hours</code>, <code className="mono">events_ttl_days</code>, …
            </p>
            <textarea rows={4} value={limits} onChange={(e) => setLimits(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={() => void save("search_limits", limits)}>
              Save limits
            </button>
          </div>

          <SettingsEntityLimitsSection onMessage={setMsg} />
          <SettingsIosPublicCollectSection onMessage={setMsg} />
          <SettingsSysdiagnoseIngestSection onMessage={setMsg} />
          <SettingsInstallEnrichmentSection onMessage={setMsg} />
        </>
      )}
    </section>
  );
}
