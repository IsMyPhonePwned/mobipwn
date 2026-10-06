import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteWebauthnCredential,
  disableTotp,
  enableTotp,
  finishWebauthnRegister,
  listWebauthnCredentials,
  pageWebauthnSite,
  setupTotp,
  startWebauthnRegister,
  type WebauthnCredential,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createSecurityKey, webauthnAvailable } from "@/lib/webauthn";
import { MyApiKeysSection } from "@/components/settings/MyApiKeysSection";

type WebauthnConfig = { origin: string; rp_id: string };

export function SettingsAccountSection() {
  const { log } = useActivityLog();
  const { user, refresh } = useAuth();
  const canWriteSettings = hasPermission(user, "settings_write");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [keys, setKeys] = useState<WebauthnCredential[]>([]);
  const [keyName, setKeyName] = useState("YubiKey");
  const [keyBusy, setKeyBusy] = useState(false);
  const [origin, setOrigin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [rpId, setRpId] = useState("");

  const loadKeys = async () => {
    try {
      setKeys(await listWebauthnCredentials());
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    void loadKeys();
    if (!hasPermission(user, "settings_read")) return;
    void fetch("/api/v1/settings/webauthn_config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: WebauthnConfig | null) => {
        if (!cfg) return;
        if (cfg.origin?.trim()) setOrigin(cfg.origin.trim());
        if (cfg.rp_id?.trim()) setRpId(cfg.rp_id.trim());
      })
      .catch(() => {});
  }, [user]);

  if (!user) return null;

  const mfaOn = user.totp_enabled || user.webauthn_enabled || keys.length > 0;
  const onLoopback = typeof window !== "undefined" && window.location.hostname === "127.0.0.1";
  const localhostHref =
    typeof window !== "undefined"
      ? `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}`
      : "";

  const siteArgs = () => pageWebauthnSite({ origin, rp_id: rpId });

  const saveWebauthnSettings = async () => {
    const body = { origin: origin.trim(), rp_id: rpId.trim() };
    const res = await fetch("/api/v1/settings/webauthn_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    log("info", "Save security key settings", body.origin || body.rp_id);
    setMsg("Security key site settings saved.");
  };

  const registerKey = async () => {
    setKeyBusy(true);
    setMsg("");
    try {
      const site = siteArgs();
      const start = await startWebauthnRegister(site);
      const credential = await createSecurityKey(start);
      const saved = await finishWebauthnRegister(start.challenge_id, credential, site, keyName);
      log("info", "Register security key", saved.name);
      setMsg(`Registered ${saved.name}.`);
      await loadKeys();
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>Account</h2>
        <p className="muted text-sm">
          Security for <strong>{user.username}</strong>
          {mfaOn ? " · MFA enabled" : " · MFA off"}.
        </p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      <MyApiKeysSection />

      <h3 className="settings-panel__subhead">Authenticator app</h3>
      <p className="muted text-xs" style={{ marginBottom: 12 }}>
        Use Google Authenticator, 1Password, Authy, or any TOTP app.
      </p>

      {!user.totp_enabled && (
        <>
          {!secret ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void setupTotp()
                  .then((r) => {
                    log("info", "Start MFA setup");
                    setSecret(r.secret);
                    setUri(r.uri);
                    setMsg("Scan the QR code, then enter a 6-digit code below.");
                  })
                  .catch((e) => setMsg(String(e)))
              }
            >
              Set up authenticator app
            </button>
          ) : (
            <div className="settings-mfa-setup">
              <div className="settings-mfa-qr">
                <QRCodeSVG value={uri} size={160} level="M" includeMargin />
              </div>
              <details className="text-xs">
                <summary className="muted" style={{ cursor: "pointer" }}>
                  Enter secret manually
                </summary>
                <p className="mono text-xs break-all" style={{ marginTop: 8 }}>
                  {secret}
                </p>
              </details>
              <div className="settings-mfa-enable">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void enableTotp(code)
                      .then(async () => {
                        log("info", "Enable MFA");
                        setMsg("Authenticator app enabled.");
                        setSecret("");
                        setCode("");
                        await refresh();
                      })
                      .catch((e) => setMsg(String(e)))
                  }
                >
                  Enable authenticator
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {user.totp_enabled && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            void disableTotp()
              .then(async () => {
                log("info", "Disable MFA");
                setMsg("Authenticator app disabled.");
                await refresh();
              })
              .catch((e) => setMsg(String(e)))
          }
        >
          Disable authenticator app
        </button>
      )}

      <h3 className="settings-panel__subhead">YubiKey / security key</h3>
      <p className="muted text-xs" style={{ marginBottom: 12 }}>
        Register a FIDO2 security key as a second factor after your password. Origin must be the URL you use
        to open this console (https, or http://localhost in development). RP ID defaults to that hostname.
      </p>
      {onLoopback && localhostHref && (
        <p className="muted text-xs" style={{ marginBottom: 12 }}>
          Open the console at <a href={localhostHref}>localhost</a> (not 127.0.0.1) to enroll a key.
        </p>
      )}
      <div className="settings-mfa-enable" style={{ marginBottom: 12 }}>
        <label>
          <span className="muted text-xs">Origin</span>
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://siem.example.com"
            autoComplete="off"
          />
        </label>
        <label>
          <span className="muted text-xs">RP ID (optional)</span>
          <input
            value={rpId}
            onChange={(e) => setRpId(e.target.value)}
            placeholder="Hostname only, e.g. example.com"
            autoComplete="off"
          />
        </label>
        {canWriteSettings && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void saveWebauthnSettings().catch((e) => setMsg(String(e)))
            }
          >
            Save site settings
          </button>
        )}
      </div>
      {keys.length > 0 && (
        <ul className="settings-webauthn-list">
          {keys.map((k) => (
            <li key={k.id} className="settings-webauthn-item">
              <span>
                <strong>{k.name}</strong>
                <span className="muted text-xs">
                  {" "}
                  · added {new Date(k.created_at).toLocaleString()}
                  {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void deleteWebauthnCredential(k.id)
                    .then(async () => {
                      log("info", "Remove security key", k.name);
                      setMsg(`Removed ${k.name}.`);
                      await loadKeys();
                      await refresh();
                    })
                    .catch((e) => setMsg(String(e)))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {webauthnAvailable() ? (
        <div className="settings-mfa-enable">
          <input
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name"
          />
          <button type="button" className="btn btn-secondary" disabled={keyBusy} onClick={() => void registerKey()}>
            {keyBusy ? "Waiting for key…" : "Add YubiKey"}
          </button>
        </div>
      ) : (
        <p className="muted text-xs">This browser does not support security keys.</p>
      )}
    </section>
  );
}
