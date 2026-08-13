import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsAndroidCollectSection } from "@/components/settings/SettingsAndroidCollectSection";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { DEFAULT_ANDROID_COLLECT } from "@/lib/androidCollectConfig";
import { DEFAULT_IOS_COLLECT } from "@/lib/collectorConfig";
import { hasPermission } from "@/lib/permissions";
import {
  fetchPublicCollectConfig,
  savePublicCollectConfig,
  type PublicCollectConfig,
} from "@/lib/publicCollect";

export function CollectorYaraSection() {
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
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    log("info", "Collector: save YARA configuration");
    try {
      const current = await fetchPublicCollectConfig();
      const next: PublicCollectConfig = {
        ...current,
        android_collect: {
          ...DEFAULT_ANDROID_COLLECT,
          ...current.android_collect,
          ...cfg.android_collect,
        },
      };
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
    <section className="card settings-section">
      <header className="settings-section__header">
        <Shield className="icon" aria-hidden />
        <div>
          <h2>{t("collector.yaraTabTitle")}</h2>
          <p className="muted text-sm">{t("collector.yaraTabSubtitle")}</p>
        </div>
      </header>

      {!loaded ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <>
          <SettingsAndroidCollectSection
            embedded
            variant="yara-only"
            value={cfg.android_collect}
            onChange={(android_collect) => setCfg((c) => ({ ...c, android_collect }))}
            disabled={!canWrite || busy}
          />
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
