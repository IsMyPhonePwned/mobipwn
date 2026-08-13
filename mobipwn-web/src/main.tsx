import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { PluginRoute } from "./components/PluginRoute";
import { ALERT_TO_SIEM_PLUGIN_ID, CASE_COMPARISON_PLUGIN_ID, COLLECTOR_PLUGIN_ID, DEVICE_ADVANCED_PLUGIN_ID, IRONSIFT_PLUGIN_ID } from "./lib/plugins";
import { ActivityLogProvider } from "./contexts/ActivityLogContext";
import { AuthProvider } from "./contexts/AuthContext";
import { LlmProvider } from "./contexts/LlmContext";
import { LocaleProvider, useLocale } from "./contexts/LocaleContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";

function CasesIndexRedirect() {
  const [params] = useSearchParams();
  const q = params.get("q");
  return (
    <Navigate
      to={q ? `/cases/search?q=${encodeURIComponent(q)}` : "/cases/search"}
      replace
    />
  );
}

const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const SearchGuidePage = lazy(() => import("./pages/SearchGuidePage"));
const MplLanguageGuidePage = lazy(() => import("./pages/MplLanguageGuidePage"));
const ArchitectureGuidePage = lazy(() => import("./pages/ArchitectureGuidePage"));
const AgentsGuidePage = lazy(() => import("./pages/AgentsGuidePage"));
const AgentsSearchGuidePage = lazy(() => import("./pages/AgentsSearchGuidePage"));
const MudmFieldsPage = lazy(() => import("./pages/MudmFieldsPage"));
const DashboardsPage = lazy(() => import("./pages/DashboardsPage"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const CasesSearchPage = lazy(() => import("./pages/CasesSearchPage"));
const CaseDetailPage = lazy(() => import("./pages/CaseDetailPage"));
const CaseIosCrashAdvancedPage = lazy(() => import("./pages/CaseIosCrashAdvancedPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const PublicCollectPage = lazy(() => import("./pages/PublicCollectPage"));
const CollectorPage = lazy(() => import("./pages/CollectorPage"));
const PublicIphoneAdvancedPage = lazy(() => import("./pages/PublicIphoneAdvancedPage"));
const PublicAndroidAdvancedPage = lazy(() => import("./pages/PublicAndroidAdvancedPage"));
const DeviceAdvancedPage = lazy(() => import("./pages/DeviceAdvancedPage"));
const IngestPage = lazy(() => import("./pages/IngestPage"));
const DataPage = lazy(() => import("./pages/DataPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const MarketplacePage = lazy(() => import("./pages/MarketplacePage"));
const DetectionsPage = lazy(() => import("./pages/DetectionsPage"));
const RuleEditorPage = lazy(() => import("./pages/RuleEditorPage"));
const RuleRepositoriesPage = lazy(() => import("./pages/RuleRepositoriesPage"));
const IronSiftPage = lazy(() => import("./pages/IronSiftPage"));
const CaseComparisonPage = lazy(() => import("./pages/CaseComparisonPage"));
const HealthPage = lazy(() => import("./pages/HealthPage"));
const AlertToSiemPage = lazy(() => import("./pages/AlertToSiemPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const LogsPage = lazy(() => import("./pages/LogsPage"));
const ShortRuleRedirect = lazy(() => import("./pages/ShortRuleRedirect"));
const ShortAlertRedirect = lazy(() => import("./pages/ShortAlertRedirect"));

function Loading() {
  const { t } = useLocale();
  return <p className="muted p-4">{t("common.loading")}</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
    <LocaleProvider>
    <ActivityLogProvider>
    <LlmProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<Suspense fallback={<Loading />}><LoginPage /></Suspense>} />
          <Route path="collect" element={<Suspense fallback={<Loading />}><PublicCollectPage /></Suspense>} />
          <Route path="iphone-advanced" element={<Suspense fallback={<Loading />}><PublicIphoneAdvancedPage /></Suspense>} />
          <Route path="android-advanced" element={<Suspense fallback={<Loading />}><PublicAndroidAdvancedPage /></Suspense>} />
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="search" element={<Suspense fallback={<Loading />}><SearchPage /></Suspense>} />
            <Route path="search/guide" element={<Suspense fallback={<Loading />}><SearchGuidePage /></Suspense>} />
            <Route path="search/mpl" element={<Suspense fallback={<Loading />}><MplLanguageGuidePage /></Suspense>} />
            <Route path="guide/architecture" element={<Suspense fallback={<Loading />}><ArchitectureGuidePage /></Suspense>} />
            <Route path="guide/agents" element={<Suspense fallback={<Loading />}><AgentsGuidePage /></Suspense>} />
            <Route path="guide/agents/search" element={<Suspense fallback={<Loading />}><AgentsSearchGuidePage /></Suspense>} />
            <Route path="mudm" element={<Suspense fallback={<Loading />}><MudmFieldsPage /></Suspense>} />
            <Route path="dashboards" element={<Suspense fallback={<Loading />}><DashboardsPage /></Suspense>} />
            <Route path="inbox" element={<Suspense fallback={<Loading />}><InboxPage /></Suspense>} />
            <Route path="cases/search" element={<Suspense fallback={<Loading />}><CasesSearchPage /></Suspense>} />
            <Route path="cases" element={<CasesIndexRedirect />} />
            <Route path="cases/:id/crashes" element={<Suspense fallback={<Loading />}><CaseIosCrashAdvancedPage /></Suspense>} />
            <Route path="cases/:id" element={<Suspense fallback={<Loading />}><CaseDetailPage /></Suspense>} />
            <Route path="ingest" element={<Suspense fallback={<Loading />}><IngestPage /></Suspense>} />
            <Route path="data" element={<Suspense fallback={<Loading />}><DataPage /></Suspense>} />
            <Route path="a/:token" element={<Suspense fallback={<Loading />}><ShortAlertRedirect /></Suspense>} />
            <Route path="r/:token" element={<Suspense fallback={<Loading />}><ShortRuleRedirect /></Suspense>} />
            <Route path="alerts" element={<Suspense fallback={<Loading />}><AlertsPage /></Suspense>} />
            <Route path="rules" element={<Suspense fallback={<Loading />}><DetectionsPage /></Suspense>} />
            <Route path="rules/editor/:id" element={<Suspense fallback={<Loading />}><RuleEditorPage /></Suspense>} />
            <Route path="rules/repositories" element={<Suspense fallback={<Loading />}><RuleRepositoriesPage /></Suspense>} />
            <Route path="detections" element={<Navigate to="/rules" replace />} />
            <Route path="marketplace" element={<Suspense fallback={<Loading />}><MarketplacePage /></Suspense>} />
            <Route
              path="ironsift"
              element={
                <Suspense fallback={<Loading />}>
                  <PluginRoute pluginId={IRONSIFT_PLUGIN_ID}>
                    <IronSiftPage />
                  </PluginRoute>
                </Suspense>
              }
            />
            <Route
              path="case-comparison"
              element={
                <Suspense fallback={<Loading />}>
                  <PluginRoute pluginId={CASE_COMPARISON_PLUGIN_ID}>
                    <CaseComparisonPage />
                  </PluginRoute>
                </Suspense>
              }
            />
            <Route path="bugreport-comparison" element={<Navigate to="/case-comparison" replace />} />
            <Route
              path="collector"
              element={
                <Suspense fallback={<Loading />}>
                  <PluginRoute pluginId={COLLECTOR_PLUGIN_ID}>
                    <CollectorPage />
                  </PluginRoute>
                </Suspense>
              }
            />
            <Route
              path="device-advanced"
              element={
                <Suspense fallback={<Loading />}>
                  <PluginRoute pluginId={DEVICE_ADVANCED_PLUGIN_ID}>
                    <DeviceAdvancedPage />
                  </PluginRoute>
                </Suspense>
              }
            />
            <Route
              path="alert-to-siem"
              element={
                <Suspense fallback={<Loading />}>
                  <PluginRoute pluginId={ALERT_TO_SIEM_PLUGIN_ID}>
                    <AlertToSiemPage />
                  </PluginRoute>
                </Suspense>
              }
            />
            <Route path="health" element={<Suspense fallback={<Loading />}><HealthPage /></Suspense>} />
            <Route path="settings" element={<Suspense fallback={<Loading />}><SettingsPage /></Suspense>} />
            <Route path="logs" element={<Suspense fallback={<Loading />}><LogsPage /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </LlmProvider>
    </ActivityLogProvider>
    </LocaleProvider>
    </ThemeProvider>
  </StrictMode>
);
