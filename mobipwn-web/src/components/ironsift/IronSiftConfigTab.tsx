import { useState } from "react";
import { AnoMarkConfigEditor } from "@/components/ironsift/AnoMarkConfigEditor";
import { DetectionConfigEditor } from "@/components/ironsift/DetectionConfigEditor";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { useLocale } from "@/contexts/LocaleContext";
import { usePlugins } from "@/contexts/PluginsContext";
import {
  saveAnomarkConfig,
  saveIronSiftConfig,
  type AnoMarkPlatformConfig,
  type IronSiftPlatformConfig,
} from "@/lib/ironsift";

type ConfigPanel = "ironsift" | "anomark";

export function IronSiftConfigTab({
  config,
  anomarkConfig,
  canWrite,
  onSaved,
}: {
  config: IronSiftPlatformConfig;
  anomarkConfig: AnoMarkPlatformConfig;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const { refresh: refreshPlugins } = usePlugins();
  const [panel, setPanel] = useState<ConfigPanel>("ironsift");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  return (
    <section className="card ironsift-card ironsift-card--config-tab">
      <header className="ironsift-config-tab-header">
        <div>
          <h2>{t("ironsift.configTabTitle")}</h2>
          <p className="muted text-xs">{t("ironsift.configTabHint")}</p>
        </div>
      </header>

      <nav className="ironsift-config-subtabs" aria-label={t("ironsift.configSubtabsLabel")}>
        <button
          type="button"
          className={`ironsift-config-subtab${panel === "ironsift" ? " ironsift-config-subtab--active" : ""}`}
          onClick={() => setPanel("ironsift")}
        >
          {t("ironsift.configSubtabIronSift")}
        </button>
        <button
          type="button"
          className={`ironsift-config-subtab${panel === "anomark" ? " ironsift-config-subtab--active" : ""}`}
          onClick={() => setPanel("anomark")}
        >
          {t("ironsift.configSubtabAnomark")}
        </button>
      </nav>

      <IronSiftFeedback error={error} success={success} />

      {panel === "ironsift" ? (
        <DetectionConfigEditor
          config={config}
          canWrite={canWrite}
          expandDetectionSections
          onSave={async (cfg) => {
            await saveIronSiftConfig(cfg);
            await refreshPlugins();
            await onSaved();
          }}
          onReload={onSaved}
          onSaved={() => setSuccess(t("ironsift.configIronSiftSaved"))}
          onProfileSuccess={(msg) => setSuccess(msg)}
          onError={(msg) => setError(msg)}
        />
      ) : (
        <AnoMarkConfigEditor
          config={anomarkConfig}
          canWrite={canWrite}
          onSave={async (cfg) => {
            await saveAnomarkConfig(cfg);
            await onSaved();
          }}
          onReload={onSaved}
          onSaved={() => setSuccess(t("ironsift.configAnomarkSaved"))}
          onProfileSuccess={(msg) => setSuccess(msg)}
          onError={(msg) => setError(msg)}
        />
      )}
    </section>
  );
}
