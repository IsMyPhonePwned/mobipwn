-- Durable audit trail for authentication, MFA/YubiKey, settings, and high-value mutations.

CREATE TABLE platform_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL,
    actor_user_id UUID,
    api_key_id UUID,
    action TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL,
    status SMALLINT NOT NULL,
    detail TEXT,
    client_ip TEXT,
    user_agent TEXT
);

CREATE INDEX idx_platform_audit_created ON platform_audit_events (created_at DESC);
CREATE INDEX idx_platform_audit_actor ON platform_audit_events (actor, created_at DESC);
CREATE INDEX idx_platform_audit_action ON platform_audit_events (action, created_at DESC);
