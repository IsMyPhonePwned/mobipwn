#!/usr/bin/env bash
# Shared env bootstrap: create .env from template, load it, apply proxy for npm/cargo/docker.
# Source from other scripts:  source "$(dirname "$0")/ensure-env.sh"
set -euo pipefail

_ensure_env_root() {
  if [[ -n "${MOBIPWN_ROOT:-}" ]]; then
    echo "$MOBIPWN_ROOT"
    return
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")/.." && pwd)"
  echo "$here"
}

# Create repo-root .env on first install (dev defaults; safe to edit locally).
ensure_env_file() {
  local root="${1:-$(_ensure_env_root)}"
  local env_file="$root/.env"
  local example="$root/.env.example"
  if [[ -f "$env_file" ]]; then
    return 0
  fi
  if [[ ! -f "$example" ]]; then
    echo "Missing $example — cannot bootstrap .env" >&2
    return 1
  fi
  cp "$example" "$env_file"
  echo "Created .env from .env.example (edit for your machine; not committed to git)."
}

# Load .env and apply mobipwn dev defaults used by ./dev.sh.
load_mobipwn_env() {
  local root="${1:-$(_ensure_env_root)}"
  ensure_env_file "$root" || true
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi
  export MOBIPWN_POSTGRES_URL="${MOBIPWN_POSTGRES_URL:-postgres://mobipwn:mobipwn@127.0.0.1:5432/mobipwn}"
  export MOBIPWN_CLICKHOUSE_URL="${MOBIPWN_CLICKHOUSE_URL:-http://127.0.0.1:8123}"
  export MOBIPWN_CLICKHOUSE_USER="${MOBIPWN_CLICKHOUSE_USER:-default}"
  export MOBIPWN_CLICKHOUSE_PASSWORD="${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}"
  export MOBIPWN_CLICKHOUSE_DB="${MOBIPWN_CLICKHOUSE_DB:-mobipwn}"
  export MOBIPWN_JOBS_ENABLED="${MOBIPWN_JOBS_ENABLED:-1}"
  export MOBIPWN_WEB_PORT="${MOBIPWN_WEB_PORT:-5173}"
  export MOBIPWN_DEV_DIR="${MOBIPWN_DEV_DIR:-.dev}"
  export MOBIPWN_COLLECT_BLOB_DIR="${MOBIPWN_COLLECT_BLOB_DIR:-.dev/collect-blobs}"
  export RUST_LOG="${RUST_LOG:-info,mobipwn=debug}"
  apply_proxy_env
  apply_cargo_network_config "$root"
}

# Cargo/proxy/TLS settings for corporate networks. See docs/PROXY.md.
# - HTTP_PROXY set  → proxy-safe cargo (sparse index, git CLI, no HTTP/2 multiplexing)
# - MOBIPWN_CARGO_INSECURE_SSL=1 → also relax git SSL + build CA bundle (Linux/macOS)
apply_cargo_network_config() {
  local root="${1:-$(_ensure_env_root)}"
  local cfg="$root/.cargo/config.toml"
  local use_proxy=0 use_insecure=0
  [[ -n "${HTTP_PROXY:-}" ]] && use_proxy=1
  [[ "${MOBIPWN_CARGO_INSECURE_SSL:-0}" == 1 ]] && use_insecure=1

  if [[ "$use_proxy" == 0 && "$use_insecure" == 0 ]]; then
    rm -f "$cfg"
    return 0
  fi

  export CARGO_NET_GIT_FETCH_WITH_CLI=true
  export CARGO_HTTP_MULTIPLEXING=false
  export CARGO_HTTP_CHECK_REVOKE=false
  export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

  if [[ "$use_insecure" == 1 ]]; then
    export GIT_SSL_NO_VERIFY=true
  fi

  _mobipwn_ensure_cargo_ca_bundle "$root"

  if [[ -n "${CARGO_HTTP_CAINFO:-}" && -f "${CARGO_HTTP_CAINFO}" ]]; then
    export SSL_CERT_FILE="${CARGO_HTTP_CAINFO}"
    export CURL_CA_BUNDLE="${CARGO_HTTP_CAINFO}"
    export GIT_SSL_CAINFO="${CARGO_HTTP_CAINFO}"
    export REQUESTS_CA_BUNDLE="${CARGO_HTTP_CAINFO}"
  fi

  mkdir -p "$root/.cargo"
  {
    echo '[net]'
    echo 'git-fetch-with-cli = true'
    echo ''
    echo '[http]'
    echo 'check-revoke = false'
    echo 'multiplexing = false'
    if [[ -n "${CARGO_HTTP_CAINFO:-}" && -f "${CARGO_HTTP_CAINFO}" ]]; then
      echo "cainfo = \"${CARGO_HTTP_CAINFO}\""
    fi
    if [[ "$use_proxy" == 1 ]]; then
      echo ''
      echo '[registries.crates-io]'
      echo 'protocol = "sparse"'
    fi
  } >"$cfg"

  if [[ "$use_insecure" == 1 ]] && git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$root" config --local http.sslVerify false 2>/dev/null || true
  fi
}

# Back-compat alias (dev.sh / compose.sh).
apply_cargo_ssl_env() {
  apply_cargo_network_config "$@"
}

# First existing system CA bundle (Linux distro paths + env).
_mobipwn_system_ca_path() {
  local f
  for f in \
    "${SSL_CERT_FILE:-}" \
    "${CURL_CA_BUNDLE:-}" \
    /etc/ssl/certs/ca-certificates.crt \
    /etc/pki/tls/certs/ca-bundle.crt \
    /etc/ssl/ca-bundle.pem \
    /etc/ssl/cert.pem \
    /usr/local/share/certs/ca-root.crt; do
    if [[ -n "$f" && -f "$f" ]]; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

# Build .dev/cargo-ca-bundle.pem: system/keychain CAs + optional corporate PEM append.
_mobipwn_ensure_cargo_ca_bundle() {
  local root="$1"
  if [[ -n "${CARGO_HTTP_CAINFO:-}" && -f "${CARGO_HTTP_CAINFO}" ]]; then
    return 0
  fi

  local bundle="$root/.dev/cargo-ca-bundle.pem"
  mkdir -p "$root/.dev"
  : >"$bundle"

  if [[ "$(uname -s)" == "Darwin" ]] && command -v security >/dev/null 2>&1; then
    security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >>"$bundle" 2>/dev/null || true
    security find-certificate -a -p /Library/Keychains/System.keychain >>"$bundle" 2>/dev/null || true
    if [[ -d "$HOME/Library/Keychains" ]]; then
      security find-certificate -a -p ~/Library/Keychains/login.keychain-db >>"$bundle" 2>/dev/null \
        || security find-certificate -a -p ~/Library/Keychains/login.keychain >>"$bundle" 2>/dev/null \
        || true
    fi
  else
    local sys_ca
    if sys_ca="$(_mobipwn_system_ca_path)"; then
      cat "$sys_ca" >>"$bundle"
    fi
  fi

  if [[ -n "${MOBIPWN_EXTRA_CA_PEM:-}" && -f "${MOBIPWN_EXTRA_CA_PEM}" ]]; then
    echo "" >>"$bundle"
    cat "${MOBIPWN_EXTRA_CA_PEM}" >>"$bundle"
  fi

  if [[ -s "$bundle" ]]; then
    export CARGO_HTTP_CAINFO="$bundle"
  fi
}

# Export HTTP(S)_PROXY for cargo, npm, curl, and Docker Compose interpolation.
apply_proxy_env() {
  export HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}"
  export HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-}}}"
  export NO_PROXY="${NO_PROXY:-${no_proxy:-localhost,127.0.0.1,postgres,clickhouse,mobipwn-api,mobipwn-search,mobipwn-jobs,mobipwn-web}}"
  if [[ -n "$HTTP_PROXY" ]]; then
    export http_proxy="$HTTP_PROXY"
    export https_proxy="$HTTPS_PROXY"
    export no_proxy="$NO_PROXY"
    export npm_config_proxy="$HTTP_PROXY"
    export npm_config_https_proxy="$HTTPS_PROXY"
    export npm_config_noproxy="$NO_PROXY"
  fi
}

# Optional mobipwn-web/.npmrc from template (proxy lines commented until HTTP_PROXY is set).
ensure_npmrc() {
  local root="${1:-$(_ensure_env_root)}"
  local web="$root/mobipwn-web"
  local npmrc="$web/.npmrc"
  local example="$web/.npmrc.example"
  if [[ ! -f "$npmrc" && -f "$example" ]]; then
    cp "$example" "$npmrc"
    echo "Created mobipwn-web/.npmrc from .npmrc.example"
  fi
  if [[ -n "${HTTP_PROXY:-}" && -f "$npmrc" ]]; then
    # Sync active proxy into .npmrc when env is set (idempotent).
    local tmp
    tmp="$(mktemp)"
    grep -vE '^(proxy|https-proxy|noproxy)=' "$npmrc" 2>/dev/null >"$tmp" || true
    {
      cat "$tmp"
      echo "proxy=${HTTP_PROXY}"
      echo "https-proxy=${HTTPS_PROXY}"
      echo "noproxy=${NO_PROXY}"
    } >"$npmrc"
    rm -f "$tmp"
  fi
}
