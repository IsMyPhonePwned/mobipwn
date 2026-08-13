import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  createAnomarkConfigProfile,
  createIronSiftConfigProfile,
  deleteAnomarkConfigProfile,
  deleteIronSiftConfigProfile,
  fetchAnomarkConfigProfiles,
  fetchIronSiftConfigProfiles,
  selectAnomarkConfigProfile,
  selectIronSiftConfigProfile,
  type AnoMarkPlatformConfig,
  type ConfigProfilesListResponse,
  type IronSiftPlatformConfig,
} from "@/lib/ironsift";

type ProfileApi<T> = {
  list: () => Promise<ConfigProfilesListResponse>;
  create: (name: string, config: T) => Promise<unknown>;
  select: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

function ConfigProfilesBarInner<T>({
  api,
  canWrite,
  getCurrentConfig,
  onApplied,
  onError,
  onSuccess,
}: {
  api: ProfileApi<T>;
  canWrite: boolean;
  getCurrentConfig: () => T;
  onApplied: () => void | Promise<void>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}) {
  const { t } = useLocale();
  const [profiles, setProfiles] = useState<ConfigProfilesListResponse>({
    profiles: [],
    selected_id: null,
  });
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await api.list();
    setProfiles(list);
    setProfileId((prev) => {
      if (prev && list.profiles.some((p) => p.id === prev)) return prev;
      return list.selected_id ?? "";
    });
  }, [api]);

  useEffect(() => {
    void refresh().catch((e) => onError?.(parseIronSiftError(e)));
  }, [refresh, onError]);

  async function run(action: () => Promise<void>, successKey?: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      await onApplied();
      if (successKey) onSuccess?.(t(successKey));
    } catch (e) {
      onError?.(parseIronSiftError(e));
    } finally {
      setBusy(false);
    }
  }

  function saveAs() {
    const name = window.prompt(t("ironsift.configProfileNamePrompt"));
    if (!name?.trim()) return;
    void run(async () => {
      await api.create(name, getCurrentConfig());
    }, "ironsift.configProfileSaved");
  }

  function applySelected() {
    if (!profileId) return;
    void run(async () => {
      await api.select(profileId);
    }, "ironsift.configProfileApplied");
  }

  function deleteSelected() {
    const profile = profiles.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    if (!window.confirm(t("ironsift.configProfileDeleteConfirm", { name: profile.name }))) return;
    void run(async () => {
      await api.remove(profileId);
      setProfileId("");
    });
  }

  return (
    <div className="ironsift-config-profiles">
      <label className="ironsift-config-field ironsift-config-field--profile">
        <span className="muted text-xs">{t("ironsift.configProfileLabel")}</span>
        <select
          className="mono"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
        >
          <option value="">{t("ironsift.configProfilePick")}</option>
          {profiles.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {profiles.selected_id === p.id ? ` (${t("ironsift.configProfileActive")})` : ""}
            </option>
          ))}
        </select>
      </label>
      <Button variant="secondary" disabled={!profileId || busy} onClick={applySelected}>
        {t("ironsift.configProfileApply")}
      </Button>
      {canWrite && (
        <>
          <Button variant="secondary" disabled={busy} onClick={saveAs}>
            {t("ironsift.configProfileSave")}
          </Button>
          <Button
            variant="secondary"
            disabled={!profileId || busy}
            onClick={deleteSelected}
          >
            {t("ironsift.configProfileDelete")}
          </Button>
        </>
      )}
    </div>
  );
}

const IRONSIFT_PROFILE_API: ProfileApi<IronSiftPlatformConfig> = {
  list: fetchIronSiftConfigProfiles,
  create: createIronSiftConfigProfile,
  select: selectIronSiftConfigProfile,
  remove: deleteIronSiftConfigProfile,
};

const ANOMARK_PROFILE_API: ProfileApi<AnoMarkPlatformConfig> = {
  list: fetchAnomarkConfigProfiles,
  create: createAnomarkConfigProfile,
  select: selectAnomarkConfigProfile,
  remove: deleteAnomarkConfigProfile,
};

export function IronSiftConfigProfilesBar(
  props: Omit<ComponentProps<typeof ConfigProfilesBarInner<IronSiftPlatformConfig>>, "api">
) {
  return <ConfigProfilesBarInner api={IRONSIFT_PROFILE_API} {...props} />;
}

export function AnomarkConfigProfilesBar(
  props: Omit<ComponentProps<typeof ConfigProfilesBarInner<AnoMarkPlatformConfig>>, "api">
) {
  return <ConfigProfilesBarInner api={ANOMARK_PROFILE_API} {...props} />;
}
