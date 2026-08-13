import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, VolumeX, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

export const FP_REASONS = [
  { id: "expected", label: "Expected behavior" },
  { id: "noisy", label: "Rule too noisy" },
  { id: "duplicate", label: "Duplicate / already triaged" },
  { id: "bad_facet", label: "Bad facet grouping" },
  { id: "other", label: "Other" },
] as const;

type Props = {
  open: boolean;
  ruleId?: string | null;
  ruleName?: string;
  facetLabel?: string;
  onClose: () => void;
  onConfirm: (payload: { reason: string; comment: string }) => Promise<void>;
  onMuteRule?: (ruleId: string, minutes: number) => Promise<void>;
};

export function FalsePositiveDialog({
  open,
  ruleId,
  ruleName,
  facetLabel,
  onClose,
  onConfirm,
  onMuteRule,
}: Props) {
  const [reason, setReason] = useState("expected");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const comment = [
    `FP: ${FP_REASONS.find((r) => r.id === reason)?.label ?? reason}`,
    facetLabel ? `facet=${facetLabel}` : "",
    notes.trim(),
  ]
    .filter(Boolean)
    .join(" — ");

  const submit = async (alsoMute?: boolean) => {
    setBusy(true);
    try {
      await onConfirm({ reason, comment });
      if (alsoMute && ruleId && onMuteRule) await onMuteRule(ruleId, 24 * 60);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fp-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fp-dialog card"
        role="dialog"
        aria-labelledby="fp-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fp-dialog__header">
          <Ban size={18} aria-hidden />
          <h2 id="fp-dialog-title">Mark false positive</h2>
        </header>
        <p className="muted fp-dialog__intro">
          {ruleName ? (
            <>
              Rule <strong>{ruleName}</strong>
              {facetLabel ? (
                <>
                  {" "}
                  · facet <code className="mono">{facetLabel}</code>
                </>
              ) : null}
            </>
          ) : (
            "Help improve detections by recording why this hit is not actionable."
          )}
        </p>
        <fieldset className="fp-dialog__reasons">
          <legend className="sr-only">Reason</legend>
          {FP_REASONS.map((r) => (
            <label key={r.id} className="fp-dialog__reason">
              <input
                type="radio"
                name="fp-reason"
                value={r.id}
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        <label className="fp-dialog__notes">
          <span className="muted text-xs">Notes (optional)</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What should change? e.g. exclude this package, raise min_hits…"
          />
        </label>
        <div className="fp-dialog__actions">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {ruleId && (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/rules?edit=${ruleId}`} onClick={onClose}>
                <Wrench size={14} aria-hidden />
                Tune rule
              </Link>
            </Button>
          )}
          {ruleId && onMuteRule && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              <VolumeX size={14} aria-hidden />
              FP + mute 24h
            </Button>
          )}
          <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
            Confirm false positive
          </Button>
        </div>
      </div>
    </div>
  );
}
