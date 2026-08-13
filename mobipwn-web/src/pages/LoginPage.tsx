import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { login, verifyMfa } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { user, loading, requireAuth, loginSuccess } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challengeId) {
        const res = await verifyMfa(challengeId, mfaCode);
        loginSuccess(res.token, res.user);
        navigate("/", { replace: true });
        return;
      }
      const res = await login(username, password);
      if ("mfa_required" in res && res.mfa_required) {
        setChallengeId(res.challenge_id);
        return;
      }
      if ("token" in res) {
        loginSuccess(res.token, res.user);
        navigate("/", { replace: true });
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
        {error && <p className="error">{error}</p>}
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
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : challengeId ? "Verify MFA" : "Sign in"}
        </Button>
        <p className="muted login-hint">
          Default account: admin / admin
          {!requireAuth && " · API auth is disabled (MOBIPWN_REQUIRE_AUTH=0)"}
        </p>
      </form>
    </div>
  );
}
