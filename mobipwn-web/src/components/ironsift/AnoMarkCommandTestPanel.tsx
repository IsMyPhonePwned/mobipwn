import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { parseIronSiftError } from "@/lib/ironsiftActivity";
import {
  mergeAnomarkConfig,
  scoreAnoMarkCommand,
  type AnoMarkCommandScore,
  type AnoMarkTrainRecord,
  type IronSiftPlatformConfig,
} from "@/lib/ironsift";

export function AnoMarkCommandTestPanel({
  trains,
  config,
  defaultTrainId,
}: {
  trains: AnoMarkTrainRecord[];
  config: IronSiftPlatformConfig;
  defaultTrainId?: string;
}) {
  const { t } = useLocale();
  const anomarkCfg = mergeAnomarkConfig(config.anomark_config);
  const [trainId, setTrainId] = useState(defaultTrainId ?? "");
  const [machine, setMachine] = useState("");
  const [command, setCommand] = useState("");
  const [suspectPercent, setSuspectPercent] = useState(anomarkCfg.default_suspect_percent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [score, setScore] = useState<AnoMarkCommandScore | null>(null);

  useEffect(() => {
    setSuspectPercent(mergeAnomarkConfig(config.anomark_config).default_suspect_percent);
  }, [config.anomark_config]);

  useEffect(() => {
    if (defaultTrainId) {
      setTrainId(defaultTrainId);
      return;
    }
    if (!trainId && trains.length > 0) {
      setTrainId(trains[0].id);
    }
  }, [defaultTrainId, trainId, trains]);

  async function runTest() {
    if (!trainId) return;
    const cmd = command.trim();
    if (!cmd) {
      setError(t("ironsift.anomarkTestCommandRequired"));
      return;
    }
    setBusy(true);
    setError("");
    setScore(null);
    try {
      const result = await scoreAnoMarkCommand(trainId, {
        command: cmd,
        machine_name: machine.trim() || undefined,
        suspect_percent: suspectPercent,
      });
      setScore(result);
    } catch (e) {
      setError(parseIronSiftError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card ironsift-anomark-test">
      <h2>{t("ironsift.anomarkTestTitle")}</h2>
      <p className="muted text-xs">{t("ironsift.anomarkTestHint")}</p>
      <p className="muted text-xs">{t("ironsift.anomarkTestMachineHint")}</p>

      {trains.length === 0 ? (
        <p className="muted">{t("ironsift.anomarkTestNoModel")}</p>
      ) : (
        <>
          <div className="ironsift-anomark-test__form">
            <label>
              <span className="muted text-xs">{t("ironsift.anomarkTestModel")}</span>
              <select value={trainId} onChange={(e) => setTrainId(e.target.value)}>
                {trains.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.label || tr.id.slice(0, 8)} ({tr.training_line_count} lines)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="muted text-xs">{t("ironsift.anomarkSuspectPct")}</span>
              <input
                type="number"
                min={55}
                max={99.9}
                step={0.5}
                value={suspectPercent}
                onChange={(e) => setSuspectPercent(Number(e.target.value))}
              />
            </label>
            <label>
              <span className="muted text-xs">{t("ironsift.anomarkTestMachine")}</span>
              <input
                className="mono"
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
                placeholder={t("ironsift.anomarkTestMachinePlaceholder")}
              />
            </label>
            <label className="ironsift-anomark-test__command">
              <span className="muted text-xs">{t("ironsift.anomarkTestCommand")}</span>
              <input
                className="mono"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t("ironsift.anomarkTestCommandPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runTest();
                }}
              />
            </label>
            <Button disabled={busy || !trainId} onClick={() => void runTest()}>
              {busy ? t("ironsift.running") : t("ironsift.anomarkTestRun")}
            </Button>
          </div>

          {error && <p className="error text-sm">{error}</p>}

          {score && (
            <div
              className={`ironsift-anomark-test__result${
                score.is_suspect ? " ironsift-anomark-test__result--suspect" : ""
              }`}
            >
              <p className="ironsift-anomark-test__verdict">
                {score.is_suspect
                  ? t("ironsift.anomarkTestSuspect")
                  : t("ironsift.anomarkTestNormal")}
              </p>
              <dl className="ironsift-anomark-test__metrics">
                <div>
                  <dt>{t("ironsift.anomarkTestLineScored")}</dt>
                  <dd className="mono text-xs">{score.line_scored}</dd>
                </div>
                <div>
                  <dt>{t("ironsift.anomarkTestLogLikelihood")}</dt>
                  <dd className="mono">{score.log_likelihood.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>{t("ironsift.anomarkTestThreshold")}</dt>
                  <dd className="mono">{score.suspect_threshold_ln.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>{t("ironsift.anomarkTestMargin")}</dt>
                  <dd className="mono">{score.margin_ln.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>{t("ironsift.anomarkTestSensitivityUsed")}</dt>
                  <dd>{score.suspect_percent_used}%</dd>
                </div>
                <div>
                  <dt>{t("ironsift.anomarkInspectOrder")}</dt>
                  <dd>{score.order}</dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
