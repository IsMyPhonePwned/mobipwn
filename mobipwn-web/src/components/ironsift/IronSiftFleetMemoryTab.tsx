import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { IronSiftFeedback } from "@/components/ironsift/IronSiftFeedback";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  deleteTriageMemory,
  fetchTriageMemory,
  type TriageMemoryEntry,
} from "@/lib/ironsift";

export function IronSiftFleetMemoryTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useLocale();
  const [entries, setEntries] = useState<TriageMemoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEntries(await fetchTriageMemory());
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.detector.toLowerCase().includes(q) ||
        e.reason.toLowerCase().includes(q) ||
        e.verdict.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const active = filtered.filter((e) => e.verdict !== "unset");

  async function drop(detector: string, reason: string) {
    if (!window.confirm(t("ironsift.fleetDropConfirm"))) return;
    setError("");
    setSuccess("");
    try {
      await deleteTriageMemory(detector, reason);
      setSuccess(t("ironsift.fleetMemoryDropped"));
      await load();
    } catch (e) {
      setError(parseIronSiftError(e));
    }
  }

  return (
    <>
      <IronSiftFeedback error={error} success={success} />

      <section className="card">
        <div className="ironsift-fleet-header">
          <div>
            <h2>{t("ironsift.fleetTitle")}</h2>
            <p className="muted text-xs">{t("ironsift.fleetIntro")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              void load()
                .then(() => setSuccess(t("ironsift.refreshDone")))
                .catch((e) => setError(parseIronSiftError(e)))
            }
          >
            {t("common.refresh")}
          </Button>
        </div>
        <input
          type="search"
          className="mono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("ironsift.fleetSearch")}
        />
        {loading && <p className="muted">{t("common.loading")}</p>}
      </section>

      <section className="card">
        <h3>{t("ironsift.fleetActiveTitle")}</h3>
        {active.length === 0 ? (
          <p className="muted">{t("ironsift.fleetEmpty")}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("ironsift.colDetector")}</th>
                <th>{t("ironsift.colReasons")}</th>
                <th>{t("ironsift.colVerdict")}</th>
                <th>{t("ironsift.colUpdated")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {active.map((e) => (
                <tr key={`${e.detector}|${e.reason}`}>
                  <td className="mono">{e.detector}</td>
                  <td>{e.reason}</td>
                  <td>{e.verdict}</td>
                  <td className="mono">{e.updated_at.slice(0, 19)}</td>
                  {canWrite && (
                    <td>
                      <Button variant="secondary" onClick={() => void drop(e.detector, e.reason)}>
                        {t("ironsift.fleetDrop")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
