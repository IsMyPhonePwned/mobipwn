-- WebAuthn / security-key (YubiKey) MFA credentials and in-flight challenges.

CREATE TABLE auth_webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    passkey JSONB NOT NULL,
    name TEXT NOT NULL DEFAULT 'YubiKey',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_auth_webauthn_credentials_user ON auth_webauthn_credentials(user_id);

CREATE TABLE auth_webauthn_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_webauthn_challenges_expires ON auth_webauthn_challenges(expires_at);
