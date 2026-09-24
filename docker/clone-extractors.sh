#!/usr/bin/env bash
# Clone sibling libs for Docker Rust builds.
# Paths match Cargo path deps: ../../NAME from /app/mobipwn-* → /NAME
set -euo pipefail

BUGREPORT_REPO="${BUGREPORT_EXTRACTOR_REPO:-https://github.com/ismyphonepwned/bugreport-extractor-library.git}"
SYSDIAGNOSE_REPO="${SYSDIAGNOSE_EXTRACTOR_REPO:-https://github.com/ismyphonepwned/sysdiagnose-extractor-library.git}"
FAKEMUSTACHE_REPO="${FAKEMUSTACHE_REPO:-https://github.com/ismyphonepwned/fakeMustache.git}"
REF="${MOBIPWN_EXTRACTOR_REF:-}"

export GIT_TERMINAL_PROMPT=0

if [[ -n "${HTTP_PROXY:-}" ]]; then
  export GIT_HTTP_PROXY="$HTTP_PROXY"
  export GIT_HTTPS_PROXY="${HTTPS_PROXY:-$HTTP_PROXY}"
  git config --global http.proxy "$HTTP_PROXY"
  git config --global https.proxy "${HTTPS_PROXY:-$HTTP_PROXY}"
fi

clone_repo() {
  local url="$1"
  local dest="$2"
  if [[ -d "$dest/.git" || -f "$dest/Cargo.toml" ]]; then
    echo "==> sibling present: $dest"
    return 0
  fi
  echo "==> cloning $url → $dest"
  if [[ -n "$REF" ]]; then
    if git clone --depth 1 --branch "$REF" "$url" "$dest"; then
      return 0
    fi
    echo "==> branch $REF not found, cloning default branch"
  fi
  git clone --depth 1 "$url" "$dest"
}

clone_repo "$BUGREPORT_REPO" /bugreport-extractor-library
clone_repo "$SYSDIAGNOSE_REPO" /sysdiagnose-extractor-library
clone_repo "$FAKEMUSTACHE_REPO" /fakeMustache
