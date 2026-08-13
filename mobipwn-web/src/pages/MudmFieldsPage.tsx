import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Braces,
  Check,
  Copy,
  Layers,
  Play,
  Search,
  Terminal,
  X,
} from "lucide-react";
import { GuideCallout, GuideExampleCard } from "@/components/mpl-guide/MplGuideBlocks";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { MUDM_FIELD_CATALOG, type MudmFieldEntry } from "@/lib/mudmFieldCatalog";
import {
  MUDM_FEATURED_FIELDS,
  MUDM_INTRO_CALLOUTS,
  mudmExampleQuery,
} from "@/lib/mudmGuideMeta";
import { tokenizeMplQuery } from "@/lib/mplQueryHighlight";

const CATEGORY_ORDER = [
  "system",
  "mobile",
  "process",
  "network",
  "authentication",
  "malware",
  "endpoint",
  "enrichment",
  "threat_intelligence",
  "detection",
] as const;

function categoryLabel(key: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    system: t("mudmFields.catSystem"),
    mobile: t("mudmFields.catMobile"),
    process: t("mudmFields.catProcess"),
    network: t("mudmFields.catNetwork"),
    authentication: t("mudmFields.catAuth"),
    malware: t("mudmFields.catMalware"),
    endpoint: t("mudmFields.catEndpoint"),
    enrichment: t("mudmFields.catEnrichment"),
    threat_intelligence: t("mudmFields.catThreatIntel"),
    detection: t("mudmFields.catDetection"),
  };
  return map[key] ?? key.replace(/_/g, " ");
}

function categoryId(category: string): string {
  return `mudm-cat-${category}`;
}

function HighlightedExampleLink({ query }: { query: string }) {
  const tokens = tokenizeMplQuery(query);
  return (
    <Link to={`/search?q=${encodeURIComponent(query)}`} className="mudm-field-example-link">
      <code className="mono">
        {tokens.map((tok, i) => (
          <span key={`${i}-${tok.value}`} className={`mpl-tok mpl-tok--${tok.kind}`}>
            {tok.value}
          </span>
        ))}
      </code>
      <Play className="icon" aria-hidden />
    </Link>
  );
}

function MudmStorageDiagram({ t }: { t: (key: string) => string }) {
  return (
    <div className="mudm-storage-diagram" aria-label={t("mudmFields.tocStorage")}>
      <div className="mudm-storage-diagram__box mudm-storage-diagram__box--column">
        <span className="mudm-storage-diagram__label">{t("mudmFields.storageColumnLabel")}</span>
        <span className="mono">{t("mudmFields.storageColumnExamples")}</span>
        <span className="muted">{t("mudmFields.storageColumnHint")}</span>
      </div>
      <span className="mudm-storage-diagram__plus">+</span>
      <div className="mudm-storage-diagram__box mudm-storage-diagram__box--ext">
        <span className="mudm-storage-diagram__label">{t("mudmFields.storageExtLabel")}</span>
        <span className="mono">{t("mudmFields.storageExtExamples")}</span>
        <span className="muted">{t("mudmFields.storageExtHint")}</span>
      </div>
    </div>
  );
}

export default function MudmFieldsPage() {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const [fields, setFields] = useState<MudmFieldEntry[]>([]);
  const [error, setError] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeId, setActiveId] = useState("start");

  useEffect(() => {
    apiFetch<MudmFieldEntry[]>("/v1/mudm/fields")
      .then((data) => {
        setFields(data);
        setUsingFallback(false);
        setError("");
        log("info", `MUDM fields catalog: ${data.length} fields`);
      })
      .catch((e) => {
        const msg = String(e);
        if (msg.includes("Not Found") || msg.includes("404")) {
          setFields(MUDM_FIELD_CATALOG);
          setUsingFallback(true);
          setError("");
          log("warn", "MUDM API unavailable — using embedded catalog");
        } else {
          setFields(MUDM_FIELD_CATALOG);
          setUsingFallback(true);
          setError(msg);
          log("error", "Load MUDM fields failed", msg);
        }
      });
  }, [log]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyName = useCallback(
    async (name: string) => {
      try {
        await navigator.clipboard.writeText(name);
        setCopied(name);
        log("info", `Copied field: ${name}`);
      } catch {
        log("warn", `Copy failed: ${name}`);
      }
    },
    [log]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return fields.filter((f) => {
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        (f.column?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [fields, filter, categoryFilter]);

  const grouped = useMemo(() => {
    const byCat = new Map<string, MudmFieldEntry[]>();
    for (const f of filtered) {
      const list = byCat.get(f.category) ?? [];
      list.push(f);
      byCat.set(f.category, list);
    }
    const order = [
      ...CATEGORY_ORDER.filter((c) => byCat.has(c)),
      ...[...byCat.keys()].filter(
        (c) => !CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number])
      ),
    ];
    return order.map((cat) => ({
      category: cat,
      fields: (byCat.get(cat) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(fields.map((f) => f.category));
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [fields]);

  const featured = useMemo(
    () =>
      MUDM_FEATURED_FIELDS.map((name) => fields.find((f) => f.name === name)).filter(
        (f): f is MudmFieldEntry => f != null
      ),
    [fields]
  );

  const columnCount = fields.filter((f) => f.storage === "column").length;
  const extCount = fields.filter((f) => f.storage === "ext").length;

  const tocIds = useMemo(
    () => ["start", "storage", ...grouped.map((g) => categoryId(g.category))],
    [grouped]
  );

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
    <div className="mpl-guide-page mudm-fields-page">
      <aside className="mpl-guide-sidebar">
        <nav className="mpl-guide-toc card" aria-label={t("mudmFields.toc")}>
          <p className="mpl-guide-toc__title">{t("mudmFields.toc")}</p>
          <ol className="mpl-guide-toc__list">
            <li>
              <a
                href="#start"
                className={activeId === "start" ? "is-active" : undefined}
                onClick={() => setActiveId("start")}
              >
                {t("mudmFields.tocStart")}
              </a>
            </li>
            <li>
              <a
                href="#storage"
                className={activeId === "storage" ? "is-active" : undefined}
                onClick={() => setActiveId("storage")}
              >
                {t("mudmFields.tocStorage")}
              </a>
            </li>
            {categoriesPresent.map((cat) => {
              const id = categoryId(cat);
              const count = fields.filter((f) => f.category === cat).length;
              return (
                <li key={cat}>
                  <a
                    href={`#${id}`}
                    className={activeId === id ? "is-active" : undefined}
                    onClick={() => setActiveId(id)}
                  >
                    {categoryLabel(cat, t)}
                    <span className="mudm-toc-count">{count}</span>
                  </a>
                </li>
              );
            })}
          </ol>
          <div className="mpl-guide-toc__links">
            <Link to="/search/mpl" className="mpl-guide-toc__link">
              <Terminal className="icon" />
              {t("mplGuide.link")}
            </Link>
            <Link to="/search/guide" className="mpl-guide-toc__link">
              <BookOpen className="icon" />
              {t("nav.searchGuide")}
            </Link>
            <Link to="/guide/architecture" className="mpl-guide-toc__link">
              <Layers className="icon" />
              {t("nav.archGuide")}
            </Link>
          </div>
        </nav>
      </aside>

      <article className="mpl-guide-article">
        <header id="start" className="mpl-guide-hero card mudm-fields-hero">
          <div className="mpl-guide-hero__top">
            <div>
              <p className="mpl-guide-hero__eyebrow">{t("mudmFields.eyebrow")}</p>
              <h1>
                <Braces className="icon inline-icon" aria-hidden />
                {t("mudmFields.title")}
              </h1>
              <p className="mpl-guide-hero__subtitle">{t("mudmFields.subtitle")}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/search">
                <Search className="icon" />
                {t("common.openSearch")}
              </Link>
            </Button>
          </div>

          {fields.length > 0 && (
            <div className="mudm-fields-stats">
              <span className="mudm-fields-stat">
                <strong>{fields.length}</strong> {t("mudmFields.fieldsTotal")}
              </span>
              <span className="mudm-fields-stat mudm-fields-stat--column">
                <strong>{columnCount}</strong> {t("mudmFields.columnStorage")}
              </span>
              <span className="mudm-fields-stat mudm-fields-stat--ext">
                <strong>{extCount}</strong> {t("mudmFields.extStorage")}
              </span>
            </div>
          )}

          <div className="mpl-guide-hero__chips">
            <span className="mpl-guide-chip">{t("mudmFields.chipAndroid")}</span>
            <span className="mpl-guide-chip">{t("mudmFields.chipIos")}</span>
            <span className="mpl-guide-chip">{t("mudmFields.chipMpl")}</span>
          </div>
        </header>

        {usingFallback && (
          <p className="mudm-fields-fallback-hint card">{t("mudmFields.fallbackHint")}</p>
        )}
        {error && <p className="error">{error}</p>}

        <section className="card mpl-guide-section">
          <p className="mpl-guide-section__lead">{t("mudmFields.whatLead")}</p>
          {MUDM_INTRO_CALLOUTS.map((c, i) => (
            <GuideCallout key={`intro-${i}`} callout={c} />
          ))}
        </section>

        {featured.length > 0 && (
          <section className="card mpl-guide-cheatsheet">
            <h2 className="mpl-guide-cheatsheet__title">{t("mudmFields.featured")}</h2>
            <p className="muted mpl-guide-cheatsheet__lead">{t("mudmFields.featuredLead")}</p>
            <div className="mpl-guide-cheatsheet__grid">
              {featured.map((f) => (
                <GuideExampleCard
                  key={f.name}
                  title={f.name}
                  note={f.description}
                  query={mudmExampleQuery(f.name)}
                  tryHref={`/search?q=${encodeURIComponent(mudmExampleQuery(f.name))}`}
                  compact
                />
              ))}
            </div>
          </section>
        )}

        <section id="storage" className="card mpl-guide-section mudm-storage-section">
          <header className="mpl-guide-section__header">
            <span className="mpl-guide-section__marker" aria-hidden />
            <div>
              <h2 className="mpl-guide-section__title">{t("mudmFields.tocStorage")}</h2>
              <p className="mpl-guide-section__lead">{t("mudmFields.storageLead")}</p>
            </div>
          </header>
          <MudmStorageDiagram t={t} />
        </section>

        <section className="card mudm-fields-toolbar">
          <div className="mudm-fields-toolbar__search">
            <Search className="icon mudm-fields-toolbar__icon" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("mudmFields.filterPlaceholder")}
              className="mudm-fields-filter-input mono"
              aria-label={t("mudmFields.filterLabel")}
            />
            {filter && (
              <button
                type="button"
                className="mudm-fields-toolbar__clear"
                onClick={() => setFilter("")}
                aria-label="Clear"
              >
                <X className="icon" />
              </button>
            )}
          </div>
          <div className="mudm-fields-category-chips">
            <button
              type="button"
              className={`mudm-category-chip${categoryFilter === null ? " mudm-category-chip--active" : ""}`}
              onClick={() => setCategoryFilter(null)}
            >
              {t("mudmFields.allCategories")}
            </button>
            {categoriesPresent.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`mudm-category-chip${categoryFilter === cat ? " mudm-category-chip--active" : ""}`}
                onClick={() => setCategoryFilter((c) => (c === cat ? null : cat))}
              >
                {categoryLabel(cat, t)}
              </button>
            ))}
          </div>
          <span className="mudm-fields-match muted">
            {filtered.length === fields.length
              ? t("mudmFields.matchAll", { count: fields.length })
              : t("mudmFields.matchFiltered", { match: filtered.length, total: fields.length })}
          </span>
        </section>

        {grouped.length === 0 && !error && (
          <p className="muted">{filter || categoryFilter ? t("mudmFields.noMatch") : t("common.loading")}</p>
        )}

        {grouped.map(({ category, fields: catFields }) => (
          <section
            key={category}
            id={categoryId(category)}
            className="card mpl-guide-section mudm-fields-category-card"
          >
            <header className="mpl-guide-section__header">
              <span className="mpl-guide-section__marker" aria-hidden />
              <div>
                <h2 className="mpl-guide-section__title">{categoryLabel(category, t)}</h2>
                <p className="muted mudm-fields-category__count">
                  {t("mudmFields.categoryFields", { count: catFields.length })}
                </p>
              </div>
            </header>
            <div className="mudm-fields-table-wrap">
              <table className="mudm-fields-table">
                <thead>
                  <tr>
                    <th>{t("mudmFields.colField")}</th>
                    <th>{t("mudmFields.colStorage")}</th>
                    <th>{t("mudmFields.colDescription")}</th>
                    <th aria-label={t("common.copy")} />
                  </tr>
                </thead>
                <tbody>
                  {catFields.map((f) => {
                    const isCopied = copied === f.name;
                    const ex = mudmExampleQuery(f.name);
                    return (
                      <tr key={f.name}>
                        <td>
                          <code className="mono mudm-field-name">{f.name}</code>
                          {f.column && f.column !== f.name && (
                            <span className="muted mudm-field-column">→ {f.column}</span>
                          )}
                        </td>
                        <td>
                          <span className={`mudm-storage-badge mudm-storage-badge--${f.storage}`}>
                            {f.storage === "column"
                              ? t("mudmFields.storageColumn")
                              : t("mudmFields.storageExt")}
                          </span>
                        </td>
                        <td>
                          <p className="mudm-field-desc">{f.description}</p>
                          <HighlightedExampleLink query={ex} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`btn btn-sm ${isCopied ? "btn-primary" : "btn-ghost"}`}
                            onClick={() => void copyName(f.name)}
                            title={t("common.copy")}
                          >
                            {isCopied ? (
                              <Check className="icon" aria-hidden />
                            ) : (
                              <Copy className="icon" aria-hidden />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <footer className="mpl-guide-footer card mudm-fields-footer">
          <p className="muted">{t("mudmFields.footer")}</p>
          <div className="mpl-guide-footer__links">
            <Link to="/search/guide">{t("nav.searchGuide")}</Link>
            <Link to="/search/mpl">{t("mplGuide.link")}</Link>
            <Link to="/search">{t("common.openSearch")}</Link>
          </div>
        </footer>
      </article>
    </div>
  );
}
