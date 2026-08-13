import { useState } from "react";
import { Link } from "react-router-dom";
import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { usePlugins } from "@/contexts/PluginsContext";
import { hasPermission } from "@/lib/permissions";
import { COLLECTOR_PLUGIN_ID, ALERT_TO_SIEM_PLUGIN_ID, DEVICE_ADVANCED_PLUGIN_ID } from "@/lib/plugins";

export function SettingsPluginsSection() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const { plugins, loaded, setEnabled } = usePlugins();
  const canWrite = hasPermission(user, "settings_write");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function toggle(id: string, next: boolean) {
    setBusy(id);
    setMsg("");
    log("info", `Plugin ${id}: ${next ? "enable" : "disable"}`);
    try {
      await setEnabled(id, next);
      setMsg(t("plugins.saved"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card settings-section plugins-settings">
      <header className="settings-section__header">
        <Puzzle className="icon" aria-hidden />
        <div>
          <h2>{t("plugins.title")}</h2>
          <p className="muted text-sm">{t("plugins.subtitle")}</p>
        </div>
      </header>

      {!loaded ? (
        <p className="muted">{t("common.loading")}</p>
      ) : plugins.length === 0 ? (
        <p className="muted">{t("plugins.empty")}</p>
      ) : (
        <ul className="plugins-list">
          {plugins.map((plugin) => (
            <li key={plugin.id} className="plugins-list__item">
              <div className="plugins-list__main">
                <div className="plugins-list__head">
                  <h3 className="plugins-list__name">{plugin.name}</h3>
                  <span className="plugins-list__version muted text-xs">v{plugin.version}</span>
                </div>
                <p className="muted text-sm plugins-list__desc">{plugin.description}</p>
                {plugin.nav_path && plugin.enabled && plugin.id !== DEVICE_ADVANCED_PLUGIN_ID && (
                  <Link to={plugin.nav_path} className="plugins-list__link text-xs">
                    {t("plugins.open", { name: plugin.name })}
                  </Link>
                )}
                {plugin.id === COLLECTOR_PLUGIN_ID && plugin.enabled && (
                  <Link
                    to="/collect"
                    target="_blank"
                    rel="noreferrer"
                    className="plugins-list__link text-xs"
                  >
                    {t("collector.openPage")}
                  </Link>
                )}
                {plugin.id === DEVICE_ADVANCED_PLUGIN_ID && plugin.enabled && (
                  <>
                    <Link
                      to="/device-advanced"
                      className="plugins-list__link text-xs"
                    >
                      {t("plugins.configure")}
                    </Link>
                    <Link
                      to="/iphone-advanced"
                      target="_blank"
                      rel="noreferrer"
                      className="plugins-list__link text-xs"
                    >
                      {t("deviceAdvanced.openIphonePublic")}
                    </Link>
                    <Link
                      to="/android-advanced"
                      target="_blank"
                      rel="noreferrer"
                      className="plugins-list__link text-xs"
                    >
                      {t("deviceAdvanced.openAndroidPublic")}
                    </Link>
                  </>
                )}
                {plugin.id === ALERT_TO_SIEM_PLUGIN_ID && plugin.enabled && plugin.nav_path && (
                  <Link to={plugin.nav_path} className="plugins-list__link text-xs">
                    {t("plugins.configure")}
                  </Link>
                )}
              </div>
              <div className="plugins-list__actions">
                <span
                  className={`plugins-list__status${plugin.enabled ? " plugins-list__status--on" : ""}`}
                >
                  {plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}
                </span>
                {canWrite && (
                  <Button
                    type="button"
                    variant={plugin.enabled ? "secondary" : "default"}
                    size="sm"
                    disabled={busy === plugin.id}
                    onClick={() => void toggle(plugin.id, !plugin.enabled)}
                  >
                    {plugin.enabled ? t("plugins.disable") : t("plugins.enable")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="settings-section__msg">{msg}</p>}
    </section>
  );
}
