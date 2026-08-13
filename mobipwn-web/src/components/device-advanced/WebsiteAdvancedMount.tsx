import { useEffect, useRef, useState } from "react";

type Props = {
  html: string;
  className: string;
  id?: string;
  boot: () => Promise<void>;
  reset: () => void;
};

/**
 * Injects vendored website advanced workspace markup, then boots the matching
 * module after the DOM nodes exist (same IDs/behavior as the site HTML pages).
 */
export function WebsiteAdvancedMount({ html, className, id, boot, reset }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;
    setError(null);
    el.innerHTML = html;
    reset();
    void (async () => {
      try {
        await boot();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      reset();
      el.innerHTML = "";
    };
  }, [html, boot, reset]);

  return (
    <div className="website-advanced-host">
      {error ? (
        <p className="device-advanced__banner device-advanced__banner--error" role="alert">
          {error}
        </p>
      ) : null}
      <div ref={hostRef} id={id} className={className} />
    </div>
  );
}
