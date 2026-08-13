import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Copy,
  FileText,
  FolderOpen,
  Layers,
  Play,
  Search,
  Terminal,
} from "lucide-react";
import {
  GuideCallout,
  GuideExampleCard,
  InlineCode,
} from "@/components/mpl-guide/MplGuideBlocks";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { defaultCaseSource } from "@/lib/caseSource";
import {
  SEARCH_EXAMPLE_CATEGORIES,
  SEARCH_EXAMPLES,
  examplesForCategory,
  resolveExampleQuery,
  type SearchExample,
} from "@/lib/searchExamples";
import {
  SEARCH_FEATURED_IDS,
  SEARCH_FIELD_TIPS,
  SEARCH_GUIDE_CALLOUTS,
} from "@/lib/searchGuideMeta";

type DataSummary = { sources: { source: string }[] };

function resolvedQuery(ex: SearchExample, caseSource: string): string {
  return ex.crossCase ? ex.query : resolveExampleQuery(ex.query, caseSource);
}

function searchLink(query: string, caseSource: string): string {
  const params = new URLSearchParams({ q: query });
  if (caseSource && query.includes(`source="${caseSource}"`)) {
    params.set("source", caseSource);
  }
  return `/search?${params.toString()}`;
}

function HuntWorkflow() {
  return (
    <ol className="search-guide-workflow" aria-label="How to use this guide">
      <li className="search-guide-workflow__step">
        <span className="search-guide-workflow__num">1</span>
        <div>
          <strong>Set case source</strong>
          <p className="muted">Pick the ingest label for scoped hunts</p>
        </div>
      </li>
      <li className="search-guide-workflow__step">
        <span className="search-guide-workflow__num">2</span>
        <div>
          <strong>Copy a query</strong>
          <p className="muted">Examples resolve source= for you</p>
        </div>
      </li>
      <li className="search-guide-workflow__step">
        <span className="search-guide-workflow__num">3</span>
        <div>
          <strong>Run in Search</strong>
          <p className="muted">Try in Search or paste into the query bar</p>
        </div>
      </li>
    </ol>
  );
}

export default function SearchGuidePage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const [caseSource, setCaseSource] = useState("case-001");
  const [sources, setSources] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("start");
  const [copyError, setCopyError] = useState("");

  const tocSections = useMemo(
    () => [
      { id: "start", label: t("searchGuide.tocStart") },
      { id: "fields", label: t("searchGuide.fieldRef") },
      ...SEARCH_EXAMPLE_CATEGORIES.map((c) => ({
        id: `cat-${c.id}`,
        label: c.title,
      })),
    ],
    [t]
  );

  const featured = useMemo(
    () =>
      SEARCH_FEATURED_IDS.map((id) => SEARCH_EXAMPLES.find((e) => e.id === id)).filter(
        (e): e is SearchExample => e != null
      ),
    []
  );

  useEffect(() => {
    apiFetch<DataSummary>("/v1/data/summary")
      .then((d) => {
        const labels = d.sources.map((s) => s.source);
        setSources(labels);
        setCaseSource(defaultCaseSource(labels));
      })
      .catch(() => setCaseSource("case-001"));
  }, []);

  useEffect(() => {
    const headings = tocSections
      .map((s) => document.getElementById(s.id))
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
  }, [tocSections]);

  const copyCaseSource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(caseSource);
      log("info", "Copied case source", caseSource);
    } catch {
      setCopyError(t("common.copyFailed"));
    }
  }, [caseSource, log, t]);

  return (
    <div className="search-guide-page mpl-guide-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("searchGuide.toc")}>
          <p className="mpl-guide-toc__title">{t("searchGuide.toc")}</p>
          <ol className="mpl-guide-toc__list">
            {tocSections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={activeId === s.id ? "is-active" : undefined}
                  onClick={() => setActiveId(s.id)}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
          <div className="mpl-guide-toc__links">
            <Link to="/guide/architecture" className="mpl-guide-toc__link">
              <Layers className="icon" />
              {t("nav.archGuide")}
            </Link>
            <Link to="/search/mpl" className="mpl-guide-toc__link">
              <Terminal className="icon" />
              {t("mplGuide.link")}
            </Link>
            <Link to="/mudm" className="mpl-guide-toc__link">
              <FileText className="icon" />
              {t("nav.mudmFields")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article search-guide-article">
        <header id="start" className="mpl-guide-hero card search-guide-hero">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("searchGuide.eyebrow")}</p>
              <h1>
                <BookOpen className="icon inline-icon" aria-hidden />
                {t("searchGuide.title")}
              </h1>
              <p className="mpl-guide-hero__subtitle">{t("searchGuide.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/search">
                <Search className="icon" />
                {t("common.openSearch")}
              </Link>
            </Button>
          </div>

          <HuntWorkflow />

          <div className="mpl-guide-hero__chips">
            <span className="mpl-guide-chip">{t("searchGuide.chipAndroid")}</span>
            <span className="mpl-guide-chip">{t("searchGuide.chipBugreport")}</span>
            <span className="mpl-guide-chip">{t("searchGuide.chipCopyRun")}</span>
          </div>
          <p className="search-guide-hero__mpl muted">
            {t("searchGuide.mplRefLead")}{" "}
            <Link to="/search/mpl">{t("mplGuide.link")}</Link>
          </p>
        </header>

        <section className="card search-guide-source-card" id="source-picker">
          <div className="search-guide-source-card__head">
            <FolderOpen className="icon accent" />
            <div>
              <h2 className="search-guide-source-card__title">{t("searchGuide.caseSource")}</h2>
              <p className="muted search-guide-source-hint">{t("searchGuide.caseHint")}</p>
            </div>
          </div>
          <label className="search-guide-source-label">
            <div className="search-guide-source-row">
              <select
                value={sources.includes(caseSource) ? caseSource : "__custom__"}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") setCaseSource(e.target.value);
                }}
              >
                {sources.length === 0 && (
                  <option value="case-001">{t("searchGuide.noDataYet")}</option>
                )}
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="__custom__">{t("searchGuide.customSource")}</option>
              </select>
              <input
                value={caseSource}
                onChange={(e) => setCaseSource(e.target.value)}
                placeholder="case-001"
                className="mono"
                aria-label={t("searchGuide.customSource")}
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyCaseSource()}>
                <Copy className="icon" />
                {t("common.copy")}
              </button>
            </div>
          </label>
          {copyError && <p className="error">{copyError}</p>}
          <p className="search-guide-source-active muted">
            {t("searchGuide.activeSource")}{" "}
            <code className="mono mpl-guide-inline-code">{caseSource}</code>
          </p>
        </section>

        {SEARCH_GUIDE_CALLOUTS.map((c, i) => (
          <GuideCallout key={`callout-${i}`} callout={c} />
        ))}

        <section className="card mpl-guide-cheatsheet">
          <h2 className="mpl-guide-cheatsheet__title">{t("searchGuide.featured")}</h2>
          <p className="muted mpl-guide-cheatsheet__lead">{t("searchGuide.featuredLead")}</p>
          <div className="mpl-guide-cheatsheet__grid">
            {featured.map((ex) => {
              const query = resolvedQuery(ex, caseSource);
              return (
                <GuideExampleCard
                  key={ex.id}
                  title={ex.label}
                  note={ex.description}
                  query={query}
                  tryHref={searchLink(query, caseSource)}
                  compact
                />
              );
            })}
          </div>
        </section>

        <section id="fields" className="card mpl-guide-section search-guide-fields">
          <header className="mpl-guide-section__header">
            <span className="mpl-guide-section__marker" aria-hidden />
            <div>
              <h2 className="mpl-guide-section__title">{t("searchGuide.fieldRef")}</h2>
              <p className="mpl-guide-section__lead">
                <InlineCode>{t("searchGuide.matchingHint")}</InlineCode>
              </p>
            </div>
          </header>
          <div className="mpl-guide-table-wrap">
            <table className="mpl-guide-table">
              <thead>
                <tr>
                  <th>{t("searchGuide.field")}</th>
                  <th>{t("searchGuide.useFor")}</th>
                </tr>
              </thead>
              <tbody>
                {SEARCH_FIELD_TIPS.map((tip) => (
                  <tr key={tip.field}>
                    <td>{tip.field}</td>
                    <td>{tip.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {SEARCH_EXAMPLE_CATEGORIES.map((cat) => {
          const examples = examplesForCategory(cat.id);
          return (
            <div key={cat.id} className="mpl-guide-group">
              <header className="mpl-guide-group__header">
                <h2 className="mpl-guide-group__title">{cat.title}</h2>
                <p className="mpl-guide-group__desc">{cat.description}</p>
              </header>

              <section id={`cat-${cat.id}`} className="card mpl-guide-section search-guide-category-card">
                <div className="search-guide-category__count muted">
                  {examples.length} {examples.length === 1 ? "query" : "queries"}
                </div>
                <div className="mpl-guide-examples">
                  {examples.map((ex) => {
                    const query = resolvedQuery(ex, caseSource);
                    return (
                      <GuideExampleCard
                        key={ex.id}
                        title={ex.label}
                        note={ex.description}
                        query={query}
                        tryHref={searchLink(query, caseSource)}
                        badge={ex.crossCase ? t("searchGuide.crossCase") : undefined}
                      />
                    );
                  })}
                </div>
              </section>
            </div>
          );
        })}

        <footer className="mpl-guide-footer card search-guide-footer">
          <p className="muted">{t("searchGuide.footer")}</p>
          <div className="mpl-guide-footer__links">
            <Link to="/guide/agents/search">{t("nav.agentsSearchGuide")}</Link>
            <Link to="/search/mpl">{t("mplGuide.link")}</Link>
            <Link to="/search">
              <Play className="icon" />
              {t("common.openSearch")}
            </Link>
          </div>
        </footer>
      </article>
    </div>
  );
}
