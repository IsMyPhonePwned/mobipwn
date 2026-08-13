import { useLocale } from "@/contexts/LocaleContext";
import {
  mergeEndpointIngestConfig,
  PULSESECURE_DEVICE_RULE,
  type EndpointIngestConfig,
} from "@/lib/ironsift";

type Props = {
  value: EndpointIngestConfig;
  canEdit: boolean;
  onChange: (next: EndpointIngestConfig) => void;
  showPreset?: boolean;
};

export function EndpointDeviceRuleFields({
  value,
  canEdit,
  onChange,
  showPreset = true,
}: Props) {
  const { t } = useLocale();
  const cfg = mergeEndpointIngestConfig(value);
  const rule = cfg.zip_device_rule ?? {};
  const useParent = rule.parent_dir_field != null && rule.parent_dir_field > 0;
  const field = rule.parent_dir_field ?? 4;
  const delimiter = rule.delimiter ?? "-";

  function patchRule(patch: Partial<typeof rule>) {
    onChange(
      mergeEndpointIngestConfig({
        ...cfg,
        zip_device_rule: { ...rule, ...patch },
      })
    );
  }

  return (
    <div className="ironsift-endpoint-device-rule">
      <p className="muted text-xs">{t("ironsift.endpointDeviceRuleHint")}</p>
      <div className="ironsift-config-grid">
        <label className="ironsift-config-field">
          <span className="muted text-xs">{t("ironsift.endpointDeviceSource")}</span>
          <select
            className="mono"
            disabled={!canEdit}
            value={useParent ? "parent_dir" : "file_stem"}
            onChange={(e) =>
              patchRule({
                parent_dir_field: e.target.value === "parent_dir" ? field || 4 : null,
              })
            }
          >
            <option value="file_stem">{t("ironsift.endpointDeviceSourceFile")}</option>
            <option value="parent_dir">{t("ironsift.endpointDeviceSourceParent")}</option>
          </select>
        </label>
        {useParent && (
          <>
            <label className="ironsift-config-field">
              <span className="muted text-xs">{t("ironsift.endpointDeviceField")}</span>
              <input
                type="number"
                className="mono"
                disabled={!canEdit}
                min={1}
                max={32}
                value={field}
                onChange={(e) =>
                  patchRule({ parent_dir_field: Number(e.target.value) || 1 })
                }
              />
            </label>
            <label className="ironsift-config-field">
              <span className="muted text-xs">{t("ironsift.endpointDeviceDelimiter")}</span>
              <input
                className="mono"
                disabled={!canEdit}
                maxLength={1}
                value={delimiter}
                onChange={(e) =>
                  patchRule({ delimiter: e.target.value || "-" })
                }
              />
            </label>
          </>
        )}
        <label className="ironsift-config-check">
          <input
            type="checkbox"
            disabled={!canEdit || !useParent}
            checked={cfg.zip_parent_tag_field != null}
            onChange={(e) =>
              onChange(
                mergeEndpointIngestConfig({
                  ...cfg,
                  zip_parent_tag_field: e.target.checked ? field : null,
                })
              )
            }
          />
          <span>{t("ironsift.endpointDeviceTagSegment")}</span>
        </label>
      </div>
      {showPreset && canEdit && (
        <button
          type="button"
          className="btn btn-secondary ironsift-endpoint-device-rule__preset"
          onClick={() =>
            onChange(
              mergeEndpointIngestConfig({
                zip_device_rule: PULSESECURE_DEVICE_RULE,
                zip_parent_tag_field: PULSESECURE_DEVICE_RULE.parent_dir_field ?? null,
              })
            )
          }
        >
          {t("ironsift.endpointDevicePresetPulse")}
        </button>
      )}
      {useParent && (
        <p className="muted text-xs mono ironsift-endpoint-device-rule__example">
          {t("ironsift.endpointDeviceExample", { field, delimiter })}
        </p>
      )}
    </div>
  );
}
