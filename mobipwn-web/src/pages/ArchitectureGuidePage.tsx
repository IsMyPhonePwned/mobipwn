import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Layers, Search, Terminal } from "lucide-react";
import {
  ArchitectureFlow,
  DocGuideSectionBody,
} from "@/components/guide/DocGuideSection";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  ARCH_GUIDE_GROUPS,
  ARCH_GUIDE_SECTIONS,
  archSectionsForGroup,
} from "@/lib/architectureGuide";

export default function ArchitectureGuidePage() {
  const { t } = useLocale();
  const [activeId, setActiveId] = useState(ARCH_GUIDE_SECTIONS[0]?.id ?? "");

  useEffect(() => {
    const headings = ARCH_GUIDE_SECTIONS.map((s) => document.getElementById(s.id)).filter(
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
    <div className="mpl-guide-page arch-guide-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("archGuide.toc")}>
          <p className="mpl-guide-toc__title">{t("archGuide.toc")}</p>
          {ARCH_GUIDE_GROUPS.map((group) => (
            <div key={group.id} className="mpl-guide-toc__group">
              <p className="mpl-guide-toc__group-title">{group.title}</p>
              <ol className="mpl-guide-toc__list">
                {archSectionsForGroup(group.id).map((s) => (
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
            </div>
          ))}
          <div className="mpl-guide-toc__links">
            <Link to="/search/mpl" className="mpl-guide-toc__link">
              <Terminal className="icon" />
              {t("mplGuide.link")}
            </Link>
            <Link to="/search/guide" className="mpl-guide-toc__link">
              <BookOpen className="icon" />
              {t("nav.searchGuide")}
            </Link>
            <Link to="/health" className="mpl-guide-toc__link">
              <Layers className="icon" />
              {t("nav.health")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article">
        <header id="start" className="mpl-guide-hero card arch-guide-hero">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("archGuide.eyebrow")}</p>
              <h1>
                <Layers className="icon inline-icon" aria-hidden />
                {t("archGuide.title")}
              </h1>
              <p className="mpl-guide-hero__subtitle">{t("archGuide.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/health">
                <Layers className="icon" />
                {t("archGuide.openHealth")}
              </Link>
            </Button>
          </div>

          <ArchitectureFlow />

          <div className="mpl-guide-hero__chips">
            <span className="mpl-guide-chip">{t("archGuide.chipNano")}</span>
            <span className="mpl-guide-chip">{t("archGuide.chipRust")}</span>
            <span className="mpl-guide-chip">{t("archGuide.chipCh")}</span>
            <span className="mpl-guide-chip">{t("archGuide.chipPg")}</span>
            <span className="mpl-guide-chip">{t("archGuide.chipReact")}</span>
          </div>
        </header>

        {ARCH_GUIDE_GROUPS.map((group) => (
          <div key={group.id} className="mpl-guide-group">
            <header className="mpl-guide-group__header">
              <h2 className="mpl-guide-group__title">{group.title}</h2>
              <p className="mpl-guide-group__desc">{group.description}</p>
            </header>

            {archSectionsForGroup(group.id).map((section) => (
              <section key={section.id} id={section.id} className="card mpl-guide-section">
                <header className="mpl-guide-section__header">
                  <span className="mpl-guide-section__marker" aria-hidden />
                  <div>
                    <h3 className="mpl-guide-section__title">{section.title}</h3>
                    {section.lead && (
                      <p className="mpl-guide-section__lead">{section.lead}</p>
                    )}
                  </div>
                </header>
                <DocGuideSectionBody section={section} />
              </section>
            ))}
          </div>
        ))}

        <footer className="mpl-guide-footer card">
          <p className="muted">{t("archGuide.footer")}</p>
          <div className="mpl-guide-footer__links">
            <Link to="/guide/agents">{t("nav.agentsGuide")}</Link>
            <Link to="/search/mpl">{t("mplGuide.link")}</Link>
            <Link to="/search/guide">{t("nav.searchGuide")}</Link>
            <Link to="/search">
              <Search className="icon" />
              {t("common.openSearch")}
            </Link>
          </div>
        </footer>
      </article>
    </div>
  );
}
