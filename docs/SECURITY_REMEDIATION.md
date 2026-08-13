# Security remediation checklist

Actionable hardening list from the security review (2026-06).  
Use for production deployments and shared/staging environments. Local-only dev may defer lower-priority items.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## P0 — Critical (before any non-local exposure)

- [ ] **Authenticate `mobipwn-search`** — Add API-key or session validation on `/v1/search/*`, or bind to `127.0.0.1` only and proxy all search through `mobipwn-api`. Never expose `:3002` on a public network.
  - Files: `mobipwn-search/src/routes.rs`, `mobipwn-search/src/main.rs`, `mobipwn-core/src/config.rs`, `docker-compose.yml`

- [ ] **Block auth bypass in production** — Refuse startup when `MOBIPWN_REQUIRE_AUTH=0` if `MOBIPWN_ENV=production` (or similar). Never inject synthetic `Admin` context outside explicit dev mode.
  - Files: `mobipwn-api/src/auth.rs`, `mobipwn-core/src/config.rs`

- [ ] **Eliminate default credentials on install** — Force password change for bootstrap admin; reject `admin`/`admin` and weak passwords when not in dev mode.
  - Files: `mobipwn-api/src/main.rs`, `mobipwn-core/src/auth/users.rs`, `.env.example`

- [ ] **Require strong DB secrets in prod** — Document and validate that Postgres, ClickHouse, and `MOBIPWN_API_KEY_ENCRYPTION_SECRET` are not dev defaults before listen.
  - Files: `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `mobipwn-core/src/auth/api_key_cipher.rs`

- [ ] **Do not publish database ports in production** — Postgres `5432` and ClickHouse `8123`/`9000` should be internal-only in prod compose.
  - Files: `docker-compose.prod.yml`, deployment docs

---

## P1 — High (first hardening sprint)

- [ ] **SSRF guard: LLM proxy** — Allowlist `https://` (and local `http://127.0.0.1` in dev only); block RFC1918, link-local, and cloud metadata IPs; set timeouts; limit redirects on `reqwest` client.
  - Files: `mobipwn-core/src/llm.rs`, `mobipwn-api/src/routes_platform.rs` (`/v1/llm/test`, `/v1/llm/chat`)

- [ ] **SSRF guard: webhooks** — Validate webhook URLs on create (scheme, no private IPs); add timeout and size limits on `notify_webhooks`.
  - Files: `mobipwn-api/src/routes_extended.rs`, `mobipwn-search/src/detection_run.rs`

- [ ] **Fix `time_from` / `time_to` injection** — Strict ISO-8601 parse only; never interpolate raw strings into ClickHouse SQL.
  - Files: `mobipwn-search/src/sql_gen.rs`, `mobipwn-search/src/execute.rs`

- [ ] **RBAC: `/v1/jobs/control`** — Require `Permission::DataAdmin` or `SettingsWrite` (admin-only). Viewer must not cancel jobs.
  - Files: `mobipwn-api/src/rbac.rs`, `mobipwn-api/src/routes_platform.rs`

- [ ] **RBAC: `/v1/dev/logs`** — Require admin; default `MOBIPWN_EXPOSE_DEV_LOGS=0` in code and `.env.example`.
  - Files: `mobipwn-api/src/rbac.rs`, `mobipwn-core/src/config.rs`, `.env.example`

- [ ] **MCP binary allowlist** — Only permit paths under workspace `target/` or explicit admin-configured directory; reject shell interpreters.
  - Files: `mobipwn-core/src/mcp_supervisor.rs`, `mobipwn-api/src/routes_mcp.rs`

- [ ] **Redact API key in MCP status** — Do not return plaintext `MOBIPWN_API_KEY` in `cursor_config`; use placeholder + `api_key_set: true`.
  - Files: `mobipwn-core/src/mcp_supervisor.rs`

- [ ] **Rate limiting: login / MFA** — Per-IP and per-username lockout or exponential backoff on `/v1/auth/login` and `/v1/auth/mfa`.
  - Files: `mobipwn-api/src/routes_auth.rs`

- [ ] **Rate limiting: search** — Enforce `SearchLimitsConfig.max_concurrent`; per-key/per-user request limits on heavy endpoints.
  - Files: `mobipwn-search/src/execute.rs`, `mobipwn-api/src/routes.rs`, `mobipwn-core/src/platform_settings.rs`

- [ ] **Restrict CORS** — Replace `CorsLayer::permissive()` with configured web UI origin(s) on API and search.
  - Files: `mobipwn-api/src/main.rs`, `mobipwn-search/src/routes.rs`

---

## P2 — Medium (production polish)

- [ ] **Session storage** — Move Bearer token from `localStorage` to `httpOnly` `Secure` `SameSite` cookie, or shorten TTL + rotate on login.
  - Files: `mobipwn-web/src/lib/auth.ts`, `mobipwn-api/src/routes_auth.rs`

- [ ] **Stronger password policy** — Minimum 12 characters; optional complexity rules for non-dev.
  - Files: `mobipwn-core/src/auth/users.rs`

- [ ] **MFA disable step-up** — Require current password or TOTP code before `POST /v1/auth/totp/disable`.
  - Files: `mobipwn-api/src/routes_auth.rs`

- [ ] **Fix API keys RBAC prefix** — `/v1/auth/api-keys/mine` and `/reveal` should not require blanket `UsersAdmin` at middleware; match handler owner logic.
  - Files: `mobipwn-api/src/rbac.rs`, `mobipwn-api/src/routes_auth.rs`

- [ ] **Ingest upload size cap** — Server-side max `file_size` on job create; reject oversized chunked uploads.
  - Files: `mobipwn-api/src/ingest.rs`

- [ ] **Trusted proxy for client IP** — Only honor `X-Forwarded-For` when `MOBIPWN_TRUSTED_PROXIES` is set.
  - Files: `mobipwn-api/src/auth.rs`

- [ ] **Protect Swagger in prod** — Disable `/swagger-ui` or require admin auth when not in dev.
  - Files: `mobipwn-api/src/main.rs`

- [ ] **Event access scoping** — Optional case/source RBAC on `GET /v1/events/{id}` for Viewer role.
  - Files: `mobipwn-api/src/routes_extended.rs`

- [ ] **Sanitize LLM error responses** — Do not return full upstream error bodies to clients (may leak internal URLs).
  - Files: `mobipwn-core/src/llm.rs`, `mobipwn-api/src/llm_chat.rs`

- [ ] **API key hashing pepper** — Add server-side pepper for SHA-256 token hashes at rest.
  - Files: `mobipwn-core/src/auth/mod.rs`

---

## P3 — Documentation & ops

- [ ] **Add `docs/SECURITY.md`** — Threat model, secure deployment guide, env var reference, dev vs prod matrix.
- [ ] **Update README** — Prominent “change defaults before deploy” warning; correct `MOBIPWN_REQUIRE_AUTH` default in tables.
- [ ] **Production `.env.example`** — Separate `env.production.example` with no dev passwords and required secrets listed.
- [ ] **Dependency audit** — Run `cargo audit` / `npm audit` in CI; document cadence.
- [ ] **Security headers** — Add `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` on API and web (via reverse proxy or middleware).

---

## Production deploy gate (manual checklist)

Before exposing MobiPwn beyond localhost:

- [ ] `MOBIPWN_REQUIRE_AUTH=1`
- [ ] `MOBIPWN_EXPOSE_DEV_LOGS=0`
- [ ] Admin password changed from default
- [ ] `MOBIPWN_API_KEY_ENCRYPTION_SECRET` set (32+ random bytes)
- [ ] Postgres / ClickHouse passwords rotated
- [ ] `mobipwn-search` not reachable without auth (or not exposed)
- [ ] TLS termination in front of API and web
- [ ] CORS limited to web origin
- [ ] Firewall: only 443 (and 80 redirect) public; no 5432 / 8123 / 3002

---

## Verification (after fixes)

- [ ] Attempt `POST :3002/v1/search/run` without credentials → **401/403**
- [ ] Viewer `POST /v1/jobs/control` → **403**
- [ ] Viewer `GET /v1/dev/logs` → **403**
- [ ] `POST /v1/llm/test` with `http://127.0.0.1:8123` → **blocked**
- [ ] Webhook URL `http://169.254.169.254/` → **rejected on create**
- [ ] `time_from` with SQL fragment → **400**
- [ ] `GET /v1/mcp/status` → no plaintext API key in JSON
- [ ] 10+ failed logins → **rate limited**

---

## References

| Area | Primary files |
|------|----------------|
| Auth / sessions | `mobipwn-api/src/auth.rs`, `mobipwn-api/src/routes_auth.rs` |
| RBAC | `mobipwn-api/src/rbac.rs`, `mobipwn-core/src/auth/permissions.rs` |
| Search / SQL | `mobipwn-search/src/routes.rs`, `mobipwn-search/src/sql_gen.rs` |
| LLM | `mobipwn-core/src/llm.rs`, `mobipwn-api/src/llm_chat.rs` |
| MCP | `mobipwn-core/src/mcp_supervisor.rs`, `mobipwn-api/src/routes_mcp.rs` |
| Ingest | `mobipwn-api/src/ingest.rs` |
| Config / env | `mobipwn-core/src/config.rs`, `.env.example`, `docker-compose.yml` |
| Web client | `mobipwn-web/src/lib/auth.ts` |
