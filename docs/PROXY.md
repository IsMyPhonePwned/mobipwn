# Proxy configuration

Use this when `npm install`, `cargo build`, or `docker compose pull/build` must go through an HTTP(S) proxy.

## Quick setup

1. Uncomment and set in **repo-root `.env`** (created automatically on first `./dev.sh` or `./compose.sh`):

```bash
HTTP_PROXY=http://proxy.corp.example:8080
HTTPS_PROXY=http://proxy.corp.example:8080
NO_PROXY=localhost,127.0.0.1,postgres,clickhouse,mobipwn-api,mobipwn-jobs,mobipwn-web,.corp.example
```

2. Restart the stack:

```bash
./dev.sh stop && ./dev.sh
# or container stack:
./compose.sh down && ./compose.sh up
```

`scripts/ensure-env.sh` exports these for **npm**, **cargo**, and **curl**. `./compose.sh` loads `.env` before every compose command.

## Docker (`./compose.sh`)

### Runtime containers

Proxy vars from `.env` are injected into **mobipwn-api**, **mobipwn-jobs**, Postgres, ClickHouse, and optional Vector via `env_file` + environment:

| Variable | Used by |
|----------|---------|
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | reqwest, curl, git, cargo |
| `http_proxy` / `https_proxy` / `no_proxy` | apt, wget, Alpine apk, npm |

Keep Docker service hostnames in `NO_PROXY` so internal API/DB traffic does not go through the corporate proxy.

### Image builds

Build args come from `.env`. `docker/setup-proxy-env.sh` writes **apt** proxy config (`Acquire::http::Proxy`) before `apt-get`. If the proxy is unreachable during image build, the Dockerfile retries `apt-get` without proxy.

If builds still fail behind a restrictive proxy, set in `.env`:

```bash
MOBIPWN_DISABLE_BUILD_PROXY=1
```

Runtime containers still use `HTTP_PROXY` from `.env` for API/jobs outbound traffic.

```bash
./compose.sh build
```

During the Rust image build, `docker/clone-extractors.sh` clones extractor libraries (git uses the same proxy).

Override in `.env` if needed: `BUGREPORT_EXTRACTOR_REPO`, `SYSDIAGNOSE_EXTRACTOR_REPO`, `MOBIPWN_EXTRACTOR_REF`.

### Image pulls (`docker pull`, `docker compose pull`)

The Docker **daemon** needs its own proxy (not only `.env`). On Linux, see [Docker proxy docs](https://docs.docker.com/config/daemon/systemd/#httphttps-proxy). On macOS Docker Desktop: **Settings → Resources → Proxies**.

## npm (mobipwn-web)

| Method | When to use |
|--------|-------------|
| `.env` `HTTP_PROXY` | Recommended — `./dev.sh` sets `npm_config_*` and syncs `mobipwn-web/.npmrc` |
| `mobipwn-web/.npmrc` | Copy from `.npmrc.example` or let `./dev.sh` create it |
| Shell | `export HTTP_PROXY=…` before `npm install` in `mobipwn-web/` |

Docker web image build passes `npm_config_proxy` from the same `.env` build args.

## Rust / cargo

`HTTP_PROXY` and `HTTPS_PROXY` from `.env` are exported before `cargo build` in `./dev.sh`. Container builds receive them as build-args for **git clone** and **cargo** (`CARGO_NET_GIT_FETCH_WITH_CLI=true`).

### Linux + HTTP proxy (intermittent crate failures)

If **some** crates download but **git dependencies** or **sparse index** fetches fail, cargo is using different code paths:

| Source | Typical failure behind proxy |
|--------|------------------------------|
| **crates.io** (registry) | TLS or HTTP/2 multiplexing through proxy |
| **git** dependencies | libgit2 ignores proxy/git SSL settings |
| **Mixed** | “sometimes works” — registry OK, `git clone` fails |

**With `HTTP_PROXY` in `.env`**, mobipwn now auto-writes `.cargo/config.toml`:

- `git-fetch-with-cli = true` — git deps use system `git` (respects `HTTP_PROXY`)
- `multiplexing = false` — avoids broken HTTP/2 through proxies
- `check-revoke = false` — skips CRL lookups (often blocked)
- `registries.crates-io protocol = "sparse"` — more reliable than legacy git index

Restart: `./dev.sh stop && ./dev.sh` — check `./dev.sh status` for `cargo proxy fixes: enabled`.

Manual cargo: **`./scripts/cargo.sh build -p mobipwn-api`** (loads `.env` + proxy config).

### SSL / TLS errors (corporate MITM, Zscaler)

Cargo has **no** `ssl-verify = false` switch. On **Linux**, also set your corporate root CA:

```bash
# Option A — append corp CA to system bundle (recommended on Linux):
MOBIPWN_EXTRA_CA_PEM=/path/to/corporate-root-ca.pem
MOBIPWN_CARGO_INSECURE_SSL=1

# Option B — point cargo directly at a PEM file:
CARGO_HTTP_CAINFO=/path/to/corporate-root-ca.pem
MOBIPWN_CARGO_INSECURE_SSL=1
```

`MOBIPWN_CARGO_INSECURE_SSL=1` copies `/etc/ssl/certs/ca-certificates.crt` (or distro equivalent) into `.dev/cargo-ca-bundle.pem`, appends `MOBIPWN_EXTRA_CA_PEM` if set, and relaxes git SSL for this repo only.

| Approach | When |
|----------|------|
| **`HTTP_PROXY` in `.env`** | Auto proxy-safe cargo (no SSL bypass) |
| **`MOBIPWN_EXTRA_CA_PEM`** | Linux corp CA not in system store |
| **`MOBIPWN_CARGO_INSECURE_SSL=1`** | Full workarounds + CA bundle + git `sslVerify false` |
| **`./dev.sh --insecure-cargo-ssl`** | Same as `MOBIPWN_CARGO_INSECURE_SSL=1` |

`MOBIPWN_CARGO_INSECURE_SSL=1` (via `./dev.sh --insecure-cargo-ssl`, `.env`, or `MOBIPWN_CARGO_INSECURE_SSL=1 ./dev.sh`) does all of the following:

| Step | Effect |
|------|--------|
| `.cargo/config.toml` | `git-fetch-with-cli`, `check-revoke = false`, `multiplexing = false`, `cainfo`, sparse index |
| Linux system CAs | `.dev/cargo-ca-bundle.pem` from `/etc/ssl/certs/…` + optional `MOBIPWN_EXTRA_CA_PEM` |
| macOS keychain | `.dev/cargo-ca-bundle.pem` when `CARGO_HTTP_CAINFO` is unset |
| Env vars | `CARGO_HTTP_CHECK_REVOKE=false`, `GIT_SSL_NO_VERIFY=true`, `SSL_CERT_FILE`, … |
| Repo-local git | `git config --local http.sslVerify false` (this repo only) |

Manual `cargo` without `./dev.sh`: use **`./scripts/cargo.sh build -p mobipwn-api`** (loads `.env` + network config).

Persisted in `.dev/ports.env` when passed on the `./dev.sh` command line (same as `--logarchive-decode`).

**Quick session hammer** (not persisted; use only when needed):

```bash
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export CARGO_HTTP_CHECK_REVOKE=false
export GIT_SSL_NO_VERIFY=true
```

**Global git config** (`git config --global http.sslVerify false`) also works with `CARGO_NET_GIT_FETCH_WITH_CLI=true` but affects all git on your machine — prefer `MOBIPWN_CARGO_INSECURE_SSL` or `CARGO_HTTP_CAINFO` instead.

**Docker builds:** set `MOBIPWN_CARGO_INSECURE_SSL=1` in `.env` before `./compose.sh build` (passed into `docker/Dockerfile.rust`).

**Permanent user config** (`~/.cargo/config.toml`):

```toml
[net]
git-fetch-with-cli = true

[http]
check-revoke = false
# cainfo = "/path/to/corporate-ca.pem"
```

## Verify

```bash
source scripts/ensure-env.sh
load_mobipwn_env
echo "HTTP_PROXY=$HTTP_PROXY"
cd mobipwn-web && npm config get proxy
```
