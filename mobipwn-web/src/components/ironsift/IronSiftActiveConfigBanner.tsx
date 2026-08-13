import type { CSSProperties } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  activeConfigProfileName,
  type ConfigProfilesListResponse,
  type IronSiftTabId,
} from "@/lib/ironsift";

function ConfigBadge({
  label,
  name,
  customLabel,
  accent,
  onOpen,
}: {
  label: string;
  name: string | null;
  customLabel: string;
  accent: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="ironsift-active-config__label">{label}</span>
      <span
        className={`ironsift-active-config__name${name ? "" : " ironsift-active-config__name--custom"}`}
      >
        {name ?? customLabel}
      </span>
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className="ironsift-active-config__badge ironsift-active-config__badge--clickable"
        style={{ "--config-accent": accent } as CSSProperties}
        onClick={onOpen}
        title={label}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className="ironsift-active-config__badge"
      style={{ "--config-accent": accent } as CSSProperties}
    >
      {body}
    </div>
  );
}

export function IronSiftActiveConfigBanner({
  ironsiftProfiles,
  anomarkProfiles,
  compact = false,
  onOpenConfig,
}: {
  ironsiftProfiles: ConfigProfilesListResponse | null;
  anomarkProfiles: ConfigProfilesListResponse | null;
  compact?: boolean;
  onOpenConfig?: (panel?: IronSiftTabId) => void;
}) {
  const { t } = useLocale();
  const ironsiftName = activeConfigProfileName(ironsiftProfiles);
  const anomarkName = activeConfigProfileName(anomarkProfiles);

  return (
    <div
      className={`ironsift-active-config${compact ? " ironsift-active-config--compact" : ""}`}
      aria-label={t("ironsift.activeConfigBannerLabel")}
    >
      <ConfigBadge
        label={t("ironsift.activeConfigIronSiftLabel")}
        name={ironsiftName}
        customLabel={t("ironsift.activeConfigCustom")}
        accent="var(--is-indigo)"
        onOpen={onOpenConfig ? () => onOpenConfig("config") : undefined}
      />
      <ConfigBadge
        label={t("ironsift.activeConfigAnomarkLabel")}
        name={anomarkName}
        customLabel={t("ironsift.activeConfigCustom")}
        accent="var(--is-violet)"
        onOpen={onOpenConfig ? () => onOpenConfig("config") : undefined}
      />
    </div>
  );
}

export function IronSiftActiveConfigNote({
  kind,
  profiles,
  onOpenConfig,
}: {
  kind: "ironsift" | "anomark";
  profiles: ConfigProfilesListResponse | null;
  onOpenConfig?: () => void;
}) {
  const { t } = useLocale();
  const name = activeConfigProfileName(profiles);
  const label =
    kind === "ironsift"
      ? t("ironsift.activeConfigIronSiftLabel")
      : t("ironsift.activeConfigAnomarkLabel");

  return (
    <p className="ironsift-active-config-note muted text-xs">
      {t("ironsift.activeConfigUsedFor", {
        kind: label,
        name: name ?? t("ironsift.activeConfigCustom"),
      })}{" "}
      {onOpenConfig && (
        <button type="button" className="ironsift-inline-link" onClick={onOpenConfig}>
          {t("ironsift.tabConfig")}
        </button>
      )}
    </p>
  );
}
