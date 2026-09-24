const PAGE_KEYS: Record<string, string> = {
  "/": "pages.home",
  "/search": "pages.search",
  "/search/guide": "pages.searchGuide",
  "/search/mpl": "pages.mplGuide",
  "/guide/architecture": "pages.archGuide",
  "/guide/agents": "pages.agentsGuide",
  "/guide/agents/search": "pages.agentsSearchGuide",
  "/dashboards": "pages.dashboards",
  "/alerts": "pages.alerts",
  "/a": "pages.alerts",
  "/r": "pages.rules",
  "/inbox": "pages.investigate",
  "/cases/search": "pages.caseSearch",
  "/rules": "pages.rules",
  "/rules/repositories": "pages.ruleRepositories",
  "/rules/editor/new": "pages.newRule",
  "/detections": "pages.rules",
  "/ingest": "pages.ingest",
  "/data": "pages.data",
  "/mudm": "pages.mudmFields",
  "/marketplace": "pages.marketplace",
  "/collector": "nav.collector",
  "/device-advanced": "deviceAdvanced.settingsTitle",
  "/case-comparison": "nav.caseComparison",
  "/bugreport-comparison": "nav.caseComparison",
  "/logs": "pages.logs",
  "/health": "pages.health",
  "/settings": "pages.settings",
};

export function titleForPath(pathname: string, t: (key: string) => string): string {
  if (PAGE_KEYS[pathname]) return t(PAGE_KEYS[pathname]);
  if (pathname.startsWith("/rules/editor/")) {
    return pathname.endsWith("/new") ? t("pages.newRule") : t("pages.editRule");
  }
  if (pathname.startsWith("/cases/") && pathname !== "/cases/search") {
    if (pathname.endsWith("/crashes")) return t("pages.caseCrashAdvanced");
    return t("pages.caseDetail");
  }
  const base = "/" + pathname.split("/").filter(Boolean)[0];
  return PAGE_KEYS[base] ? t(PAGE_KEYS[base]) : t("pages.appName");
}
