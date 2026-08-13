import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { alertShortPath, alertShortUrl, ruleShortPath, ruleShortUrl } from "@/lib/shortUrl";

export type ShareKind = "rule" | "alert";

type Props = {
  id: string;
  kind: ShareKind;
  /** bar: copy field under titles · icon: table rows */
  variant?: "bar" | "icon";
  className?: string;
  onCopied?: (url: string) => void;
};

export async function copyShareLink(id: string, kind: ShareKind): Promise<string> {
  const url = kind === "rule" ? ruleShortUrl(id) : alertShortUrl(id);
  await navigator.clipboard.writeText(url);
  return url;
}

export function sharePath(id: string, kind: ShareKind): string {
  return kind === "rule" ? ruleShortPath(id) : alertShortPath(id);
}

export function ShareShortLink({
  id,
  kind,
  variant = "bar",
  className,
  onCopied,
}: Props) {
  const [copied, setCopied] = useState(false);
  const path = sharePath(id, kind);
  const url = `${window.location.origin}${path}`;

  const onCopy = async () => {
    await copyShareLink(id, kind);
    setCopied(true);
    onCopied?.(url);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        className={className ?? "btn btn-ghost btn-sm share-short-link--icon"}
        onClick={(e) => {
          e.stopPropagation();
          void onCopy();
        }}
        title={copied ? "Copied!" : `Copy link ${path}`}
        aria-label={`Copy share link ${path}`}
      >
        {copied ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
      </button>
    );
  }

  return (
    <div className={`share-short-link share-short-link--bar${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="share-short-link__bar-field"
        onClick={() => void onCopy()}
        title={`Copy ${url}`}
      >
        <Link2 size={13} aria-hidden className="share-short-link__bar-icon" />
        <span className="mono share-short-link__bar-path">{path}</span>
      </button>
      <button
        type="button"
        className="share-short-link__bar-copy"
        onClick={() => void onCopy()}
        title={`Copy ${url}`}
      >
        {copied ? (
          <>
            <Check size={13} aria-hidden />
            Copied
          </>
        ) : (
          <>
            <Copy size={13} aria-hidden />
            Copy link
          </>
        )}
      </button>
    </div>
  );
}
