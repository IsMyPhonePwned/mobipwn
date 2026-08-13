import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Layers, Search, Settings, Terminal } from "lucide-react";
import { GuideCallout, InlineCode } from "@/components/mpl-guide/MplGuideBlocks";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { AGENTS_GUIDE_LINKS, AGENTS_GUIDE_SECTIONS } from "@/lib/agentsGuide";

function AgentsSectionBody({
  section,
}: {
  section: (typeof AGENTS_GUIDE_SECTIONS)[number];
}) {
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
      {section.links && (
        <ul className="doc-guide-links">
          {section.links.map((link) => (
            <li key={link.href}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              ) : (
                <Link to={link.href}>{link.label}</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {section.code && (
        <pre className="doc-guide-snippet__pre mono mpl-guide-section__code">{section.code.body}</pre>
      )}
    </>
  );
}

export default function AgentsGuidePage() {
  const { t } = useLocale();
  const [activeId, setActiveId] = useState(AGENTS_GUIDE_SECTIONS[0]?.id ?? "");

  useEffect(() => {
    const headings = AGENTS_GUIDE_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      Boolean
    ) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-18% 0px -55% 0px", threshold: [0, 0.2, 0.5, 1] }
    );
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mpl-guide-page agents-guide-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("agentsGuide.toc")}>
          <p className="mpl-guide-toc__title">{t("agentsGuide.toc")}</p>
          <ol className="mpl-guide-toc__list">
            {AGENTS_GUIDE_SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={activeId === s.id ? "is-active" : undefined}
                  onClick={() => setActiveId(s.id)}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
          <div className="mpl-guide-toc__links">
            <Link to="/guide/agents/search" className="mpl-guide-toc__link">
              <Search className="icon" />
              {t("agentsGuide.craftingLink")}
            </Link>
            <Link to="/search/mpl" className="mpl-guide-toc__link">
              <Terminal className="icon" />
              {t("mplGuide.link")}
            </Link>
            <Link to="/guide/architecture" className="mpl-guide-toc__link">
              <Layers className="icon" />
              {t("nav.archGuide")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article">
        <header id="intro" className="mpl-guide-hero card agents-guide-hero">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("agentsGuide.eyebrow")}</p>
              <h1>
                <Bot className="icon inline-icon" aria-hidden />
                {t("agentsGuide.title")}
              </h1>
              <p className="mpl-guide-hero__subtitle">{t("agentsGuide.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/guide/agents/search">
                <Search className="icon" />
                {t("agentsGuide.craftingLink")}
              </Link>
            </Button>
          </div>
          <div className="mpl-guide-hero__chips">
            <span className="mpl-guide-chip">{t("agentsGuide.chipLlm")}</span>
            <span className="mpl-guide-chip">{t("agentsGuide.chipDac")}</span>
            <span className="mpl-guide-chip">mobipwn-mcp</span>
          </div>
        </header>

        {AGENTS_GUIDE_SECTIONS.filter((s) => s.id !== "intro").map((section) => (
          <section key={section.id} id={section.id} className="card mpl-guide-section">
            <header className="mpl-guide-section__header">
              <span className="mpl-guide-section__marker" aria-hidden />
              <div>
                <h2 className="mpl-guide-section__title">{section.title}</h2>
                {section.lead && (
                  <p className="mpl-guide-section__lead">{section.lead}</p>
                )}
              </div>
            </header>
            <AgentsSectionBody section={section} />
          </section>
        ))}

        <footer className="mpl-guide-footer card">
          <p className="muted">{t("agentsGuide.footer")}</p>
          <div className="mpl-guide-footer__links">
            {AGENTS_GUIDE_LINKS.map((link) => (
              <Link key={link.to} to={link.to}>
                {link.label}
              </Link>
            ))}
            <Link to="/settings">
              <Settings className="icon" />
              {t("nav.settings")}
            </Link>
          </div>
        </footer>
      </article>
    </div>
  );
}
