import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, FileText, Layers, Search, Terminal } from "lucide-react";
import {
  GuideCallout,
  GuideExampleCard,
  InlineCode,
  QueryAnatomy,
} from "@/components/mpl-guide/MplGuideBlocks";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  MPL_CHEATSHEET,
  MPL_GUIDE_GROUPS,
  MPL_GUIDE_SECTIONS,
  sectionsForGroup,
} from "@/lib/mplLanguageGuide";

export default function MplLanguageGuidePage() {
  const { t } = useLocale();
  const [activeId, setActiveId] = useState<string>(MPL_GUIDE_SECTIONS[0]?.id ?? "");

  useEffect(() => {
    const headings = MPL_GUIDE_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      Boolean
    ) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] }
    );

    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mpl-guide-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("mplGuide.toc")}>
          <p className="mpl-guide-toc__title">{t("mplGuide.toc")}</p>
          {MPL_GUIDE_GROUPS.map((group) => (
            <div key={group.id} className="mpl-guide-toc__group">
              <p className="mpl-guide-toc__group-title">{group.title}</p>
              <ol className="mpl-guide-toc__list">
                {sectionsForGroup(group.id).map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={activeId === s.id ? "is-active" : undefined}
                      onClick={() => setActiveId(s.id)}
                    >
                      {s.command ? (
                        <code className="mpl-guide-toc__cmd">{s.command}</code>
                      ) : (
                        s.title
                      )}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        <div className="mpl-guide-toc__links">
          <Link to="/guide/architecture" className="mpl-guide-toc__link">
            <Layers className="icon" />
            {t("nav.archGuide")}
          </Link>
          <Link to="/search/guide" className="mpl-guide-toc__link">
            <BookOpen className="icon" />
            {t("nav.searchGuide")}
          </Link>
          <Link to="/mudm" className="mpl-guide-toc__link">
              <FileText className="icon" />
              {t("nav.mudmFields")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article">
        <header className="mpl-guide-hero card">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("mplGuide.eyebrow")}</p>
              <h1>
                <Terminal className="icon inline-icon" aria-hidden />
                {t("mplGuide.title")}
              </h1>
              <p className="mpl-guide-hero__subtitle">{t("mplGuide.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/search">
                <Search className="icon" />
                {t("common.openSearch")}
              </Link>
            </Button>
          </div>
          <QueryAnatomy />
          <div className="mpl-guide-hero__chips">
            <span className="mpl-guide-chip">{t("mplGuide.chipSearch")}</span>
            <span className="mpl-guide-chip">{t("mplGuide.chipRules")}</span>
            <span className="mpl-guide-chip">{t("mplGuide.chipClickhouse")}</span>
          </div>
        </header>

        <section className="card mpl-guide-cheatsheet">
          <h2 className="mpl-guide-cheatsheet__title">{t("mplGuide.cheatsheet")}</h2>
          <p className="muted mpl-guide-cheatsheet__lead">{t("mplGuide.cheatsheetLead")}</p>
          <div className="mpl-guide-cheatsheet__grid">
            {MPL_CHEATSHEET.map((ex) => (
              <GuideExampleCard key={ex.title} {...ex} compact />
            ))}
          </div>
        </section>

        {MPL_GUIDE_GROUPS.map((group) => (
          <div key={group.id} className="mpl-guide-group">
            <header className="mpl-guide-group__header">
              <h2 className="mpl-guide-group__title">{group.title}</h2>
              <p className="mpl-guide-group__desc">{group.description}</p>
            </header>

            {sectionsForGroup(group.id).map((section) => (
              <section key={section.id} id={section.id} className="card mpl-guide-section">
                <header className="mpl-guide-section__header">
                  {section.command ? (
                    <code className="mpl-guide-command-badge">{section.command}</code>
                  ) : (
                    <span className="mpl-guide-section__marker" aria-hidden />
                  )}
                  <div>
                    <h3 className="mpl-guide-section__title">{section.title}</h3>
                    {section.lead && (
                      <p className="mpl-guide-section__lead">
                        <InlineCode>{section.lead}</InlineCode>
                      </p>
                    )}
                  </div>
                </header>

                {section.paragraphs?.map((p) => (
                  <p key={p} className="mpl-guide-section__p">
                    <InlineCode>{p}</InlineCode>
                  </p>
                ))}

                {section.callouts?.map((c, i) => (
                  <GuideCallout key={`${section.id}-callout-${i}`} callout={c} />
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

                {section.examples && section.examples.length > 0 && (
                  <div className="mpl-guide-examples">
                    {section.examples.map((ex, i) => (
                      <GuideExampleCard key={`${section.id}-ex-${i}`} {...ex} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ))}

        <footer className="mpl-guide-footer card">
          <p className="muted">{t("mplGuide.footer")}</p>
          <div className="mpl-guide-footer__links">
            <Link to="/guide/agents">{t("nav.agentsGuide")}</Link>
            <Link to="/guide/architecture">{t("nav.archGuide")}</Link>
            <Link to="/search/guide">{t("nav.searchGuide")}</Link>
            <Link to="/search">{t("common.openSearch")}</Link>
          </div>
        </footer>
      </article>
    </div>
  );
}
