import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { disableTotp, enableTotp, setupTotp } from "@/lib/auth";
import { MyApiKeysSection } from "@/components/settings/MyApiKeysSection";

export function SettingsAccountSection() {
  const { log } = useActivityLog();
  const { user, refresh } = useAuth();
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (!user) return null;

  return (
    <section className="settings-panel card editor">
      <header className="settings-panel__header">
        <h2>Account</h2>
        <p className="muted text-sm">
          Security for <strong>{user.username}</strong>
          {user.totp_enabled ? " · MFA enabled" : " · MFA off"}.
        </p>
      </header>

      {msg && <p className="settings-panel__msg muted text-xs">{msg}</p>}

      <MyApiKeysSection />

      <h3 className="settings-panel__subhead">Multi-factor authentication</h3>
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
              Set up MFA
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
                        setMsg("MFA enabled.");
                        setSecret("");
                        setCode("");
                        await refresh();
                      })
                      .catch((e) => setMsg(String(e)))
                  }
                >
                  Enable MFA
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
                setMsg("MFA disabled.");
                await refresh();
              })
              .catch((e) => setMsg(String(e)))
          }
        >
          Disable MFA
        </button>
      )}
    </section>
  );
}
