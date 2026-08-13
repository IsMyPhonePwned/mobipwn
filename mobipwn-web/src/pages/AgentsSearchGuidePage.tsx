import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Bot, Terminal } from "lucide-react";
import {
  GuideCallout,
  GuideExampleCard,
  InlineCode,
} from "@/components/mpl-guide/MplGuideBlocks";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { tokenizeMplQuery } from "@/lib/mplQueryHighlight";
import {
  AGENTS_SEARCH_CALLOUTS,
  AGENTS_SEARCH_NEXT_LINKS,
  AGENTS_SEARCH_PRACTICE,
  AGENTS_SEARCH_PROMOTE,
  AGENTS_SEARCH_STEPS,
  AGENTS_SEARCH_TIPS,
  AGENTS_SEARCH_WHY,
} from "@/lib/agentsSearchGuide";

function HighlightedQuery({ query }: { query: string }) {
  const tokens = tokenizeMplQuery(query);
  return (
    <pre className="doc-guide-snippet__pre mono agents-search-example">
      {tokens.map((tok, i) => (
        <span key={`${i}-${tok.value}`} className={`mpl-tok mpl-tok--${tok.kind}`}>
          {tok.value}
        </span>
      ))}
    </pre>
  );
}

function StepBody({ step }: { step: (typeof AGENTS_SEARCH_STEPS)[number] }) {
  return (
    <>
      {step.bullets && (
        <ul className="mpl-guide-list">
          {step.bullets.map((b) => (
            <li key={b}>
              <InlineCode>{b}</InlineCode>
            </li>
          ))}
        </ul>
      )}
      {step.examplePrompt && (
        <figure className="agents-search-prompt">
          <figcaption className="muted">Example prompt</figcaption>
          <blockquote>{step.examplePrompt}</blockquote>
        </figure>
      )}
      {step.exampleQuery && <HighlightedQuery query={step.exampleQuery} />}
      {step.table && (
        <div className="mpl-guide-table-wrap">
          <table className="mpl-guide-table">
            <thead>
              <tr>
                {step.table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {step.table.rows.map((row, i) => (
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
      {step.code && (
        <pre className="doc-guide-snippet__pre mono mpl-guide-section__code">{step.code}</pre>
      )}
      {step.callouts?.map((c, i) => (
        <GuideCallout key={`${step.id}-c-${i}`} callout={c} />
      ))}
    </>
  );
}

export default function AgentsSearchGuidePage() {
  const { t } = useLocale();
  const [activeId, setActiveId] = useState("start");

  const tocIds = [
    "start",
    "why",
    ...AGENTS_SEARCH_STEPS.map((s) => s.id),
    "promote",
    "practice",
    "tips",
  ];

  useEffect(() => {
    const headings = tocIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
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
  }, [tocIds]);

  return (
    <div className="mpl-guide-page agents-search-guide-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("agentsSearchGuide.toc")}>
          <p className="mpl-guide-toc__title">{t("agentsSearchGuide.toc")}</p>
          <ol className="mpl-guide-toc__list">
            <li>
              <a
                href="#start"
                className={activeId === "start" ? "is-active" : undefined}
                onClick={() => setActiveId("start")}
              >
                {t("agentsSearchGuide.tocStart")}
              </a>
            </li>
            <li>
              <a
                href="#why"
                className={activeId === "why" ? "is-active" : undefined}
                onClick={() => setActiveId("why")}
              >
                {t("agentsSearchGuide.why")}
              </a>
            </li>
            {AGENTS_SEARCH_STEPS.map((step) => (
              <li key={step.id}>
                <a
                  href={`#${step.id}`}
                  className={activeId === step.id ? "is-active" : undefined}
                  onClick={() => setActiveId(step.id)}
                >
                  {step.number}. {step.title}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#promote"
                className={activeId === "promote" ? "is-active" : undefined}
                onClick={() => setActiveId("promote")}
              >
                {t("agentsSearchGuide.promote")}
              </a>
            </li>
            <li>
              <a
                href="#practice"
                className={activeId === "practice" ? "is-active" : undefined}
                onClick={() => setActiveId("practice")}
              >
                {t("agentsSearchGuide.practice")}
              </a>
            </li>
            <li>
              <a
                href="#tips"
                className={activeId === "tips" ? "is-active" : undefined}
                onClick={() => setActiveId("tips")}
              >
                {t("agentsSearchGuide.tips")}
              </a>
            </li>
          </ol>
          <div className="mpl-guide-toc__links">
            <Link to="/guide/agents" className="mpl-guide-toc__link">
              <Bot className="icon" />
              {t("nav.agentsGuide")}
            </Link>
            <Link to="/search/mpl" className="mpl-guide-toc__link">
              <Terminal className="icon" />
              {t("mplGuide.link")}
            </Link>
            <Link to="/search/guide" className="mpl-guide-toc__link">
              <BookOpen className="icon" />
              {t("nav.searchGuide")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article">
        <header id="start" className="mpl-guide-hero card agents-search-hero">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("agentsSearchGuide.eyebrow")}</p>
              <h1>{t("agentsSearchGuide.title")}</h1>
              <p className="mpl-guide-hero__subtitle">{t("agentsSearchGuide.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/search">
                <BookOpen className="icon" />
                {t("common.openSearch")}
              </Link>
            </Button>
          </div>
          {AGENTS_SEARCH_CALLOUTS.map((c, i) => (
            <GuideCallout key={`hero-c-${i}`} callout={c} />
          ))}
        </header>

        <section id="why" className="card mpl-guide-section">
          <header className="mpl-guide-section__header">
            <span className="mpl-guide-section__marker" aria-hidden />
            <div>
              <h2 className="mpl-guide-section__title">{t("agentsSearchGuide.why")}</h2>
              <p className="mpl-guide-section__lead">{t("agentsSearchGuide.whyLead")}</p>
            </div>
          </header>
          <ul className="mpl-guide-list">
            {AGENTS_SEARCH_WHY.map((item) => (
              <li key={item}>
                <InlineCode>{item}</InlineCode>
              </li>
            ))}
          </ul>
        </section>

        {AGENTS_SEARCH_STEPS.map((step) => (
          <section key={step.id} id={step.id} className="card mpl-guide-section">
            <header className="mpl-guide-section__header">
              <span className="mpl-guide-section__marker agents-search-step-num">{step.number}</span>
              <div>
                <h2 className="mpl-guide-section__title">{step.title}</h2>
                <p className="mpl-guide-section__lead">{step.lead}</p>
              </div>
            </header>
            <StepBody step={step} />
          </section>
        ))}

        <section id="promote" className="card mpl-guide-section">
          <header className="mpl-guide-section__header">
            <span className="mpl-guide-section__marker" aria-hidden />
            <div>
              <h2 className="mpl-guide-section__title">{t("agentsSearchGuide.promote")}</h2>
              <p className="mpl-guide-section__lead">{AGENTS_SEARCH_PROMOTE.lead}</p>
            </div>
          </header>
          <figure className="agents-search-prompt">
            <figcaption className="muted">Ask your agent</figcaption>
            <blockquote>{AGENTS_SEARCH_PROMOTE.agentPrompt}</blockquote>
          </figure>
          <ul className="mpl-guide-list">
            {AGENTS_SEARCH_PROMOTE.bullets.map((b) => (
              <li key={b}>
                <InlineCode>{b}</InlineCode>
              </li>
            ))}
          </ul>
          <pre className="doc-guide-snippet__pre mono mpl-guide-section__code">
            {AGENTS_SEARCH_PROMOTE.code}
          </pre>
        </section>

        <section id="practice" className="card mpl-guide-cheatsheet">
          <h2 className="mpl-guide-cheatsheet__title">{t("agentsSearchGuide.practice")}</h2>
          <p className="muted mpl-guide-cheatsheet__lead">{t("agentsSearchGuide.practiceLead")}</p>
          <div className="mpl-guide-cheatsheet__grid">
            {AGENTS_SEARCH_PRACTICE.map((ex) => (
              <GuideExampleCard
                key={ex.title}
                title={ex.title}
                query={ex.query}
                tryHref={`/search?q=${encodeURIComponent(ex.query)}`}
                compact
              />
            ))}
          </div>
        </section>

        <section id="tips" className="card mpl-guide-section">
          <header className="mpl-guide-section__header">
            <span className="mpl-guide-section__marker" aria-hidden />
            <div>
              <h2 className="mpl-guide-section__title">{t("agentsSearchGuide.tips")}</h2>
              <p className="mpl-guide-section__lead">{t("agentsSearchGuide.tipsLead")}</p>
            </div>
          </header>
          {AGENTS_SEARCH_TIPS.map((c, i) => (
            <GuideCallout key={`tip-${i}`} callout={c} />
          ))}
        </section>

        <footer className="mpl-guide-footer card">
          <p className="muted">{t("agentsSearchGuide.footer")}</p>
          <div className="mpl-guide-footer__links">
            {AGENTS_SEARCH_NEXT_LINKS.map((link) => (
              <Link key={link.to} to={link.to}>
                {t(link.labelKey)}
              </Link>
            ))}
            <a
              href="https://github.com/ismyphonepwned/mobipwn/blob/main/docs/MCP.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              mobipwn-mcp setup
            </a>
          </div>
        </footer>
      </article>
    </div>
  );
}
