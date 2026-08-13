import { useEffect, useMemo, useRef } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import {
  Bot,
  Database,
  KeyRound,
  Palette,
  Plug,
  Puzzle,
  SlidersHorizontal,
  UserCircle,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { SettingsAccountSection } from "@/components/settings/SettingsAccountSection";
import { SettingsGeneralSection } from "@/components/settings/SettingsGeneralSection";
import { SettingsLlmSection } from "@/components/settings/SettingsLlmSection";
import { SettingsMcpSection } from "@/components/settings/SettingsMcpSection";
import { SettingsPluginsSection } from "@/components/settings/SettingsPluginsSection";
import { SettingsBackupSection } from "@/components/settings/SettingsBackupSection";
import { SettingsUsersSection } from "@/components/settings/SettingsUsersSection";
import { SettingsAppearanceSection } from "@/components/settings/SettingsAppearanceSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasPermission } from "@/lib/permissions";

type SettingsSection =
  | "appearance"
  | "general"
  | "plugins"
  | "llm"
  | "mcp"
  | "backup"
  | "users"
  | "keys"
  | "account";

const SECTION_META: Record<
  SettingsSection,
  { label: string; description: string; icon: typeof SlidersHorizontal }
> = {
  appearance: { label: "Appearance", description: "Theme & UI colors", icon: Palette },
  general: { label: "General", description: "Retention, limits, maintenance", icon: SlidersHorizontal },
  plugins: { label: "Plugins", description: "Optional feature modules", icon: Puzzle },
  llm: { label: "LLM", description: "In-app assistant", icon: Bot },
  mcp: { label: "MCP", description: "Cursor / Claude tools", icon: Plug },
  backup: { label: "Backup", description: "Export & restore data", icon: Database },
  users: { label: "Users", description: "Accounts & roles", icon: Users },
  keys: { label: "API keys", description: "MCP & script tokens", icon: KeyRound },
  account: { label: "Account", description: "MFA & security", icon: UserCircle },
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { log } = useActivityLog();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageSettings = hasPermission(user, "settings_write");
  const canManageSuppressions = hasPermission(user, "notifications_write");
  const canManageUsers = hasPermission(user, "users_admin");
  const canBackup = hasPermission(user, "data_admin");

  const legacySection = searchParams.get("section");
  const configurePlugin = searchParams.get("configure");

  const sections = useMemo(() => {
    const out: SettingsSection[] = ["appearance"];
    if (canManageSettings || canManageSuppressions) out.push("general");
    if (canManageSettings) {
      out.push("plugins", "llm", "mcp");
    }
    if (canBackup) out.push("backup");
    if (canManageUsers) out.push("users", "keys");
    out.push("account");
    return out;
  }, [canManageSettings, canManageSuppressions, canManageUsers, canBackup]);

  const active = (searchParams.get("section") as SettingsSection | null) ?? sections[0] ?? "account";
  const safeActive = sections.includes(active) ? active : sections[0] ?? "account";

  const setSection = (id: SettingsSection) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", id);
    next.delete("configure");
    setSearchParams(next, { replace: true });
  };

  const lastLoggedSection = useRef<string | null>(null);
  useEffect(() => {
    if (lastLoggedSection.current === safeActive) return;
    lastLoggedSection.current = safeActive;
    const meta = SECTION_META[safeActive];
    log("info", `Settings: open ${meta.label}`, meta.description);
  }, [safeActive, log]);

  if (legacySection === "collect" || configurePlugin === "public_collect" || configurePlugin === "collector") {
    return <Navigate to="/collector?tab=settings" replace />;
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        description="Platform configuration, integrations, and your account."
      />

      <div className="settings-layout">
        <nav className="settings-nav card" aria-label="Settings sections">
          <ul className="settings-nav__list">
            {sections.map((id) => {
              const meta = SECTION_META[id];
              const Icon = meta.icon;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`settings-nav__item${safeActive === id ? " settings-nav__item--active" : ""}`}
                    onClick={() => setSection(id)}
                    aria-current={safeActive === id ? "page" : undefined}
                  >
                    <Icon size={16} aria-hidden className="settings-nav__icon" />
                    <span className="settings-nav__text">
                      <span className="settings-nav__label">{meta.label}</span>
                      <span className="settings-nav__desc">{meta.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="settings-main">
          {safeActive === "appearance" && <SettingsAppearanceSection />}
          {safeActive === "general" && <SettingsGeneralSection />}
          {safeActive === "plugins" && <SettingsPluginsSection />}
          {safeActive === "llm" && <SettingsLlmSection />}
          {safeActive === "mcp" && <SettingsMcpSection />}
          {safeActive === "backup" && <SettingsBackupSection />}
          {safeActive === "users" && <SettingsUsersSection />}
          {safeActive === "keys" && (
            <ApiKeysSection embedded className="settings-panel" />
          )}
          {safeActive === "account" && <SettingsAccountSection />}
        </div>
      </div>
    </div>
  );
}
