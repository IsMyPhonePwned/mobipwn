import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { GuideCallout, InlineCode } from "@/components/mpl-guide/MplGuideBlocks";
import type { ArchGuideSection } from "@/lib/architectureGuide";

function CodeSnippet({ title, body }: { title?: string; body: string }) {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      log("info", "Copied snippet");
    } catch {
      log("warn", "Copy failed");
    }
  }, [body, log]);

  return (
    <figure className="doc-guide-snippet">
      {title && <figcaption className="doc-guide-snippet__title">{title}</figcaption>}
      <div className="doc-guide-snippet__row">
        <pre className="doc-guide-snippet__pre mono">{body}</pre>
        <button
          type="button"
          className={`btn btn-sm ${copied ? "btn-primary" : "btn-secondary"}`}
          onClick={() => void copy()}
        >
          {copied ? <Check className="icon" /> : <Copy className="icon" />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
    </figure>
  );
}

export function DocGuideSectionBody({ section }: { section: ArchGuideSection }) {
  return (
    <>
      {section.paragraphs?.map((p) => (
        <p key={p} className="mpl-guide-section__p">
          <InlineCode>{p}</InlineCode>
        </p>
      ))}

      {section.callouts?.map((c, i) => (
        <GuideCallout key={`${section.id}-c-${i}`} callout={c} />
      ))}

      {section.diagram && (
        <pre className="doc-guide-diagram mono" aria-label="Architecture diagram">
          {section.diagram}
        </pre>
      )}

      {section.table && (
        <div className="mpl-guide-table-wrap">
          <table className="mpl-guide-table">
            <thead>
              <tr>
                {section.table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <InlineCode>{cell}</InlineCode>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section.list && (
        <ul className="mpl-guide-list">
          {section.list.map((item) => (
            <li key={item}>
              <InlineCode>{item}</InlineCode>
            </li>
          ))}
        </ul>
      )}

      {section.links && section.links.length > 0 && (
        <ul className="doc-guide-links">
          {section.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {section.code && <CodeSnippet title={section.code.title} body={section.code.body} />}
    </>
  );
}

export function ArchitectureFlow() {
  return (
    <div className="arch-guide-flow" aria-label="Data flow">
      <div className="arch-guide-flow__step arch-guide-flow__step--ingest">
        <span className="arch-guide-flow__label">Ingest</span>
        <span>Archives & JSONL</span>
      </div>
      <span className="arch-guide-flow__arrow" aria-hidden>
        →
      </span>
      <div className="arch-guide-flow__step arch-guide-flow__step--mudm">
        <span className="arch-guide-flow__label">MUDM</span>
        <span>Normalize</span>
      </div>
      <span className="arch-guide-flow__arrow" aria-hidden>
        →
      </span>
      <div className="arch-guide-flow__step arch-guide-flow__step--ch">
        <span className="arch-guide-flow__label">ClickHouse</span>
        <span>events</span>
      </div>
      <span className="arch-guide-flow__arrow" aria-hidden>
        →
      </span>
      <div className="arch-guide-flow__step arch-guide-flow__step--hunt">
        <span className="arch-guide-flow__label">Hunt & detect</span>
        <span>mPL · rules</span>
      </div>
      <span className="arch-guide-flow__arrow" aria-hidden>
        →
      </span>
      <div className="arch-guide-flow__step arch-guide-flow__step--pg">
        <span className="arch-guide-flow__label">Postgres</span>
        <span>alerts · cases</span>
      </div>
    </div>
  );
}
