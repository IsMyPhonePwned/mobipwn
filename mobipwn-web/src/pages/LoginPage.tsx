import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { finishMfaWebauthn, login, pageWebauthnSite, startMfaWebauthn, verifyMfa } from "@/lib/auth";
import { assertSecurityKey, webauthnAvailable } from "@/lib/webauthn";
import { Button } from "@/components/ui/button";
import { appVersion } from "@/lib/appVersion";

export default function LoginPage() {
  const { user, loading, requireAuth, loginSuccess } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [totpAvailable, setTotpAvailable] = useState(false);
  const [webauthnAvailableMfa, setWebauthnAvailableMfa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onLoopback = window.location.hostname === "127.0.0.1";
  const localhostHref = `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}`;

  const completeLogin = (token: string, nextUser: Parameters<typeof loginSuccess>[1]) => {
    loginSuccess(token, nextUser);
    navigate("/", { replace: true });
  };

  const verifySecurityKey = async (id: string) => {
    const site = pageWebauthnSite();
    const options = await startMfaWebauthn(id, site);
    const credential = await assertSecurityKey(options);
    const res = await finishMfaWebauthn(id, credential, site);
    completeLogin(res.token, res.user);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challengeId) {
        if (totpAvailable && mfaCode.trim()) {
          const res = await verifyMfa(challengeId, mfaCode);
          completeLogin(res.token, res.user);
          return;
        }
        if (webauthnAvailableMfa) {
          await verifySecurityKey(challengeId);
          return;
        }
        const res = await verifyMfa(challengeId, mfaCode);
        completeLogin(res.token, res.user);
        return;
      }
      const res = await login(username, password);
      if ("mfa_required" in res && res.mfa_required) {
        setChallengeId(res.challenge_id);
        setTotpAvailable(!!res.totp_available);
        setWebauthnAvailableMfa(!!res.webauthn_available);
        if (res.webauthn_available && !res.totp_available && webauthnAvailable()) {
          await verifySecurityKey(res.challenge_id);
        }
        return;
      }
      if ("token" in res) {
        completeLogin(res.token, res.user);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={(e) => void submit(e)}>
        <h1>mobipwn</h1>
        <p className="muted">Sign in to the Mobile SIEM console</p>
        <p className="muted login-version">{appVersion()}</p>
        {error && <p className="error">{error}</p>}
        {onLoopback && (
          <p className="muted text-xs">
            YubiKey MFA needs{" "}
            <a href={localhostHref}>localhost</a> instead of 127.0.0.1.
          </p>
        )}
        {!challengeId ? (
          <>
            <label>
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </>
        ) : (
          <>
            {totpAvailable && (
              <label>
                <span>Authenticator code</span>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                />
              </label>
            )}
            {webauthnAvailableMfa && (
              <p className="muted text-xs">Touch your YubiKey when the browser prompts you.</p>
            )}
          </>
        )}
        <Button type="submit" disabled={busy}>
          {busy
            ? "Signing in…"
            : challengeId
              ? webauthnAvailableMfa && !mfaCode.trim()
                ? "Use security key"
                : "Verify MFA"
              : "Sign in"}
        </Button>
        {challengeId && webauthnAvailableMfa && totpAvailable && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void verifySecurityKey(challengeId)
                .catch((err) => setError(String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Use YubiKey
          </Button>
        )}
        <p className="muted login-hint">
          Default account: admin / admin
          {!requireAuth && " · API auth is disabled (MOBIPWN_REQUIRE_AUTH=0)"}
        </p>
      </form>
    </div>
  );
}
