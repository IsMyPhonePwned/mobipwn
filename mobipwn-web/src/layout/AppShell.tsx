import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { canAccessRoute, hasPermission } from "@/lib/permissions";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Database,
  Home,
  Inbox,
  LayoutGrid,
  Menu,
  PanelLeft,
  BookOpen,
  Bot,
  Braces,
  Layers,
  Search,
  Settings,
  Shield,
  Upload,
  Table2,
  Activity,
  FolderSearch,
  ScrollText,
} from "lucide-react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActivityLogButton } from "@/components/logs/ActivityLogPanel";
import { AssistantPanel, AssistantSummon } from "@/components/assistant/AssistantPanel";
import { RequirePermission } from "@/components/RequirePermission";
import { PluginsProvider, usePlugins } from "@/contexts/PluginsContext";
import { enabledPluginsWithNav, pluginNavMeta } from "@/lib/pluginNav";
import { titleForPath } from "./pageTitles";

const MAIN_NAV = [
  { to: "/", labelKey: "nav.home", icon: Home, end: true },
  { to: "/search", labelKey: "nav.search", icon: Search, end: true },
  { to: "/dashboards", labelKey: "nav.dashboards", icon: LayoutGrid },
  { to: "/alerts", labelKey: "nav.alerts", icon: Bell },
] as const;

const CASES_NAV = [
  { to: "/inbox", labelKey: "nav.investigate", icon: Inbox },
  { to: "/cases/search", labelKey: "nav.caseSearch", icon: FolderSearch },
] as const;

const OPS_NAV = [
  { to: "/rules", labelKey: "nav.rules", icon: Shield },
  { to: "/ingest", labelKey: "nav.ingest", icon: Upload },
  { to: "/data", labelKey: "nav.data", icon: Table2 },
  { to: "/marketplace", labelKey: "nav.marketplace", icon: Database },
] as const;

const HELP_NAV = [
  { to: "/search/guide", labelKey: "nav.searchGuide", icon: BookOpen },
  { to: "/guide/architecture", labelKey: "nav.archGuide", icon: Layers },
  { to: "/guide/agents", labelKey: "nav.agentsGuide", icon: Bot, end: true },
  { to: "/guide/agents/search", labelKey: "nav.agentsSearchGuide", icon: Search },
  { to: "/mudm", labelKey: "nav.mudmFields", icon: Braces },
] as const;

const BOTTOM_NAV = [
  { to: "/logs", labelKey: "nav.logs", icon: ScrollText },
  { to: "/health", labelKey: "nav.health", icon: Activity },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const;

const SIDEBAR_KEY = "mobipwn-sidebar-expanded";

export function AppShell() {
  return (
    <PluginsProvider>
      <AppShellInner />
    </PluginsProvider>
  );
}

function AppShellInner() {
  const location = useLocation();
  const { log } = useActivityLog();
  const { t } = useLocale();
  const { user, loading, requireAuth, logout } = useAuth();
  const { plugins, loaded: pluginsLoaded } = usePlugins();
  const [expanded, setExpanded] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "0");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, expanded ? "1" : "0");
  }, [expanded]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => {
      if (!mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    log("info", `Page: ${titleForPath(location.pathname, t)}`, location.pathname);
  }, [location.pathname, log, t]);

  const isSearch = location.pathname === "/search";
  const pageTitle = titleForPath(location.pathname, t);

  const link = (
    to: string,
    label: string,
    Icon: ComponentType<{ strokeWidth?: number }>,
    end?: boolean
  ) => {
    if (user && !canAccessRoute(user, to)) return null;
    return (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
      title={label}
      onClick={() => setMobileNavOpen(false)}
    >
      <Icon strokeWidth={1.75} />
      <span className="nav-label">{label}</span>
    </NavLink>
    );
  };

  const pluginNavLinks = useMemo(() => {
    if (!pluginsLoaded) return [];
    return enabledPluginsWithNav(plugins)
      .map((plugin) => {
        const path = plugin.nav_path;
        if (!path) return null;
        const meta = pluginNavMeta(plugin.id);
        const label = meta.labelKey ? t(meta.labelKey) : plugin.name;
        return link(path, label, meta.icon);
      })
      .filter(Boolean);
  }, [plugins, pluginsLoaded, t, user]);

  if (requireAuth && !loading && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const navSection = (
    items: readonly {
      to: string;
      labelKey: string;
      icon: ComponentType<{ strokeWidth?: number }>;
      end?: boolean;
    }[]
  ) =>
    items
      .map(({ to, labelKey, icon: Icon, ...rest }) =>
        link(to, t(labelKey), Icon, "end" in rest ? rest.end : undefined)
      )
      .filter(Boolean);

  return (
    <div className={`app-root${expanded ? " expanded" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label={t("nav.closeMenu")}
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />
      <aside className="sidebar" aria-label={t("nav.mainMenu")}>
        <Link to="/" className="sidebar-brand" title="MobiPwn home" onClick={() => setMobileNavOpen(false)}>
          <img
            src="/logo.png"
            alt="MobiPwn — mobile SIEM and threat analytics"
            className="sidebar-brand-logo"
          />
          <span className="sidebar-brand-text">MobiPwn</span>
        </Link>
        <nav className="sidebar-nav" aria-label="Main">
          {navSection(MAIN_NAV)}
          <span className="nav-section-label">{t("nav.cases")}</span>
          {navSection(CASES_NAV)}
          <span className="nav-section-label">{t("nav.dataSection")}</span>
          {navSection(OPS_NAV)}
          {pluginNavLinks.length > 0 && (
            <>
              <span className="nav-section-label">{t("nav.plugins")}</span>
              {pluginNavLinks}
            </>
          )}
          <span className="nav-section-label">{t("nav.helpSection")}</span>
          {navSection(HELP_NAV)}
          <span className="nav-section-label">{t("nav.platform")}</span>
          {navSection(BOTTOM_NAV)}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => {
              const next = !expanded;
              log("info", next ? "Sidebar expanded" : "Sidebar collapsed");
              setExpanded(next);
            }}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {expanded ? <ChevronLeft size={16} /> : <PanelLeft size={16} />}
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="topbar-menu-btn"
            aria-label={mobileNavOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <Menu size={18} aria-hidden />
          </button>
          <span className="topbar-title">{pageTitle}</span>
          <span className="topbar-meta">{t("topbar.tagline")}</span>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
          <LocaleSwitcher />
          <ThemeToggle />
          <ActivityLogButton />
          {hasPermission(user, "llm_use") && <AssistantSummon />}
          {user && (
            <button type="button" className="btn btn-ghost btn-sm topbar-user" onClick={() => void logout()} title={user.username}>
              <span className="topbar-user-name">{user.username}</span>
              <span className="muted topbar-user-role">{user.role}</span>
            </button>
          )}
          {!expanded && (
            <button
              type="button"
              className="btn btn-ghost topbar-expand-sidebar"
              onClick={() => {
                log("info", "Sidebar expanded");
                setExpanded(true);
              }}
              aria-label="Expand sidebar"
            >
              <ChevronRight size={14} />
            </button>
          )}
          </div>
        </header>
        <div className={isSearch ? "page-content page-content--flush" : "page-content"}>
          <RequirePermission>
            <Outlet />
          </RequirePermission>
        </div>
      </div>
      <AssistantPanel />
    </div>
  );
}
