import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { usePlugins } from "@/contexts/PluginsContext";

export function PluginRoute({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { loaded, isEnabled } = usePlugins();

  if (!loaded) {
    return <p className="muted p-4">{t("common.loading")}</p>;
  }

  if (!isEnabled(pluginId)) {
    return (
      <div className="card plugin-disabled-page">
        <Puzzle className="icon plugin-disabled-page__icon" aria-hidden />
        <h1>{t("plugins.disabledTitle")}</h1>
        <p className="muted">{t("plugins.disabledBody")}</p>
        <Button variant="secondary" asChild>
          <Link to="/settings?section=plugins">{t("plugins.openSettings")}</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
