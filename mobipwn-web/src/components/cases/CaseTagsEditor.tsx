import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { parseCaseTagInput, patchCaseTags } from "@/lib/cases";
import { parseIronSiftError } from "@/lib/ironsiftActivity";

export function CaseTagsEditor({
  caseId,
  tags,
  canWrite,
  compact = false,
  onUpdated,
  onSuccess,
  onError,
}: {
  caseId: string;
  tags: string[];
  canWrite: boolean;
  compact?: boolean;
  onUpdated: (tags: string[]) => void;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addTags() {
    const toAdd = parseCaseTagInput(input);
    if (toAdd.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const updated = await patchCaseTags(caseId, { add: toAdd });
      onUpdated(updated.tags);
      setInput("");
      onSuccess?.();
    } catch (e) {
      const msg = parseIronSiftError(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tag: string) {
    setBusy(true);
    setError("");
    try {
      const updated = await patchCaseTags(caseId, { remove: [tag] });
      onUpdated(updated.tags);
      onSuccess?.();
    } catch (e) {
      const msg = parseIronSiftError(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="case-tags-editor">
      <div className="case-tags-editor__list">
        {tags.length === 0 ? (
          <span className="muted text-xs">{t("cases.tagsEmpty")}</span>
        ) : (
          tags.map((tag) => (
            <span key={tag} className="pill case-tags-editor__pill">
              {tag}
              {canWrite && (
                <button
                  type="button"
                  className="case-tags-editor__remove"
                  disabled={busy}
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => void removeTag(tag)}
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </div>
      {canWrite && (
        <div className="case-tags-editor__form">
          <input
            className="mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("cases.tagsPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTags();
            }}
          />
          <Button variant="secondary" disabled={busy || !input.trim()} onClick={() => void addTags()}>
            {t("cases.tagsAdd")}
          </Button>
        </div>
      )}
      {!compact && <p className="muted text-xs">{t("cases.tagsHint")}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
