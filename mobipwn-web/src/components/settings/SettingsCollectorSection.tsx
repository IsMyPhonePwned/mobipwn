import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_ANDROID_COLLECT } from "@/lib/androidCollectConfig";
import { DEFAULT_IOS_COLLECT } from "@/lib/collectorConfig";
import {
  fetchPublicCollectConfig,
  savePublicCollectConfig,
  type PublicCollectConfig,
} from "@/lib/publicCollect";
import { SettingsAndroidCollectSection } from "@/components/settings/SettingsAndroidCollectSection";
import { SettingsIosCollectSection } from "@/components/settings/SettingsIosCollectSection";

export function SettingsCollectorSection() {
  const { t } = useLocale();
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canWrite = hasPermission(user, "settings_write");
  const [cfg, setCfg] = useState<PublicCollectConfig>({
    enabled: false,
    tags: [],
    android_collect: DEFAULT_ANDROID_COLLECT,
    ios_collect: DEFAULT_IOS_COLLECT,
  });
  const [tagsText, setTagsText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchPublicCollectConfig()
      .then((c) => {
        setCfg({
          ...c,
          android_collect: { ...DEFAULT_ANDROID_COLLECT, ...c.android_collect },
          ios_collect: { ...DEFAULT_IOS_COLLECT, ...c.ios_collect },
        });
        setTagsText(c.tags.join(", "));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const next = { ...cfg, tags };
    log("info", "Collector: save configuration");
    try {
      await savePublicCollectConfig(next);
      setCfg(next);
      setMsg(t("collector.saved"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section settings-section--nested">
      <header className="settings-section__header">
        <Smartphone className="icon" aria-hidden />
        <div>
          <h2>{t("collector.settingsTitle")}</h2>
          <p className="muted text-sm">{t("collector.settingsSubtitle")}</p>
        </div>
      </header>

      {!loaded ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          <label className="settings-field">
            <span className="settings-field__label">{t("collector.tagsLabel")}</span>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              disabled={!canWrite || busy}
              placeholder="collector, webusb"
            />
            <span className="muted text-xs">{t("collector.tagsHint")}</span>
          </label>

          <div className="collector-settings__platforms">
            <section className="settings-subsection collector-settings__platform">
              <header className="settings-subsection__header">
                <div>
                  <h3>{t("collector.androidTitle")}</h3>
                  <p className="muted text-sm">{t("collector.androidSubtitle")}</p>
                </div>
              </header>
              <SettingsAndroidCollectSection
                embedded
                variant="no-yara"
                value={cfg.android_collect}
                onChange={(android_collect) => setCfg((c) => ({ ...c, android_collect }))}
                disabled={!canWrite || busy}
              />
            </section>

            <section className="settings-subsection collector-settings__platform">
              <header className="settings-subsection__header">
                <div>
                  <h3>{t("collector.iosTitle")}</h3>
                  <p className="muted text-sm">{t("collector.iosSubtitle")}</p>
                </div>
              </header>
              <SettingsIosCollectSection
                value={cfg.ios_collect}
                onChange={(ios_collect) => setCfg((c) => ({ ...c, ios_collect }))}
                disabled={!canWrite || busy}
                onMessage={setMsg}
              />
            </section>
          </div>

          <div className="settings-actions">
            {canWrite && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
          {msg && <p className="text-sm settings-msg">{msg}</p>}
        </>
      )}
    </section>
  );
}
