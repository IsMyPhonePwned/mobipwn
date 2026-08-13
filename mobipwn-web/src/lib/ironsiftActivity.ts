import type { IngestProgressStep } from "@/lib/ingestProgress";
import type { AnoMarkTrainResult } from "@/lib/ironsift";

export type AnoMarkTrainPhase = "scope" | "extract" | "train" | "persist" | "done";

const ANOMARK_PHASE_ORDER: AnoMarkTrainPhase[] = ["scope", "extract", "train", "persist", "done"];

const ANOMARK_PHASE_PERCENT: Record<AnoMarkTrainPhase, number> = {
  scope: 15,
  extract: 40,
  train: 70,
  persist: 90,
  done: 100,
};

/** Turn API / fetch errors into a short user-facing string. */
export function parseIronSiftError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg) as { error?: string; message?: string };
        if (parsed.error) return parsed.error;
        if (parsed.message) return parsed.message;
      } catch {
        /* fall through */
      }
    }
    return msg || "Request failed";
  }
  if (typeof err === "string") return err.trim() || "Request failed";
  return String(err);
}

export function anomarkTrainPercent(phase: AnoMarkTrainPhase): number {
  return ANOMARK_PHASE_PERCENT[phase];
}

export function anomarkTrainSteps(
  phase: AnoMarkTrainPhase | null,
  labels: { scope: string; extract: string; train: string; persist: string }
): IngestProgressStep[] {
  const stepLabels = [labels.scope, labels.extract, labels.train, labels.persist];
  const idx = phase ? ANOMARK_PHASE_ORDER.indexOf(phase) : -1;
  return stepLabels.map((label, i) => ({
    id: ANOMARK_PHASE_ORDER[i],
    label,
    status:
      idx < 0 ? "pending" : i < idx ? "done" : i === idx ? "active" : "pending",
  }));
}

/** Advance AnoMark train phases while waiting on the blocking API call. */
export function startAnoMarkTrainProgress(
  onPhase: (phase: AnoMarkTrainPhase) => void,
  intervalMs = 900
): () => void {
  let idx = 0;
  onPhase(ANOMARK_PHASE_ORDER[idx]);
  const timer = window.setInterval(() => {
    idx = Math.min(idx + 1, ANOMARK_PHASE_ORDER.length - 2);
    onPhase(ANOMARK_PHASE_ORDER[idx]);
  }, intervalMs);
  return () => window.clearInterval(timer);
}

export type AnoMarkTrainSuccessCopy = {
  message: string;
  warning?: string;
};

export function formatAnoMarkTrainSuccess(
  result: AnoMarkTrainResult,
  t: (key: string, vars?: Record<string, string | number>) => string
): AnoMarkTrainSuccessCopy {
  const label = result.record.label || result.train_id.slice(0, 8);
  const copy: AnoMarkTrainSuccessCopy = {
    message: t("ironsift.anomarkTrainSuccess", {
      label,
      lines: result.stats.training_line_count,
      machines: result.stats.distinct_machines,
      order: result.stats.order,
      logs: result.stats.process_log_count,
    }),
  };
  if (result.stats.scope_relaxed) {
    copy.warning = t("ironsift.anomarkTrainScopeRelaxed");
  }
  return copy;
}

export type IronSiftRunPhase =
  | "scope"
  | "extract"
  | "cluster"
  | "anomark"
  | "findings"
  | "done";

const RUN_PHASE_ORDER: IronSiftRunPhase[] = [
  "scope",
  "extract",
  "cluster",
  "anomark",
  "findings",
  "done",
];

const RUN_PHASE_PERCENT: Record<IronSiftRunPhase, number> = {
  scope: 12,
  extract: 30,
  cluster: 55,
  anomark: 75,
  findings: 92,
  done: 100,
};

export function ironsiftRunPercent(phase: IronSiftRunPhase): number {
  return RUN_PHASE_PERCENT[phase];
}

export function ironsiftRunPhaseSteps(
  phase: IronSiftRunPhase | null,
  withAnomark: boolean,
  labels: {
    scope: string;
    extract: string;
    cluster: string;
    anomark: string;
    findings: string;
  }
): IngestProgressStep[] {
  const phases: IronSiftRunPhase[] = withAnomark
    ? ["scope", "extract", "cluster", "anomark", "findings"]
    : ["scope", "extract", "cluster", "findings"];
  const stepLabels = withAnomark
    ? [labels.scope, labels.extract, labels.cluster, labels.anomark, labels.findings]
    : [labels.scope, labels.extract, labels.cluster, labels.findings];
  const idx = phase ? phases.indexOf(phase) : -1;
  return stepLabels.map((label, i) => ({
    id: phases[i],
    label,
    status:
      phase === "done"
        ? "done"
        : idx < 0
          ? "pending"
          : i < idx
            ? "done"
            : i === idx
              ? "active"
              : "pending",
  }));
}

export function startIronSiftRunProgress(
  onPhase: (phase: IronSiftRunPhase) => void,
  withAnomark: boolean,
  intervalMs = 1100
): () => void {
  const phases: IronSiftRunPhase[] = withAnomark
    ? ["scope", "extract", "cluster", "anomark", "findings"]
    : ["scope", "extract", "cluster", "findings"];
  let idx = 0;
  onPhase(phases[idx]);
  const timer = window.setInterval(() => {
    idx = Math.min(idx + 1, phases.length - 1);
    onPhase(phases[idx]);
  }, intervalMs);
  return () => window.clearInterval(timer);
}
