#!/usr/bin/env bash
# Load MobiPwn image bundle(s) built by ./scripts/build-docker-images.sh on another host.
#
# Usage:
#   ./scripts/load-docker-images.sh ./dist/share
#   ./scripts/load-docker-images.sh ./dist/share/mobipwn-images-1.0.0-amd64.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
Load MobiPwn Docker images exported by build-docker-images.sh / build-share-image.sh.

Usage:
  ./scripts/load-docker-images.sh PATH

PATH may be:
  - a single .tar.gz file
  - a directory (picks the host-arch bundle when present, else all mobipwn-images-*.tar.gz)

Host arch detection: amd64/x86_64 → *-amd64.tar.gz; arm64/aarch64 → *-arm64.tar.gz
EOF
}

if [[ $# -lt 1 ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

TARGET="${1:?}"
shopt -s nullglob

host_arch_suffix() {
  local m
  m="$(uname -m)"
  case "$m" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "" ;;
  esac
}

load_one() {
  local f="$1"
  echo "==> Loading $f"
  if command -v docker >/dev/null 2>&1; then
    gunzip -c "$f" | docker load
  elif command -v podman >/dev/null 2>&1; then
    gunzip -c "$f" | podman load
  else
    echo "Need docker or podman on PATH." >&2
    exit 1
  fi
}

if [[ -f "$TARGET" ]]; then
  load_one "$TARGET"
elif [[ -d "$TARGET" ]]; then
  archives=("$TARGET"/mobipwn-images-*.tar.gz)
  if ((${#archives[@]} == 0)); then
    echo "No mobipwn-images-*.tar.gz in $TARGET" >&2
    exit 1
  fi

  arch="$(host_arch_suffix)"
  matched=()
  if [[ -n "$arch" ]]; then
    for f in "${archives[@]}"; do
      base="$(basename "$f")"
      if [[ "$base" == *"-${arch}.tar.gz" ]]; then
        matched+=("$f")
      fi
    done
  fi

  if ((${#matched[@]} > 0)); then
    echo "==> Host arch ${arch}: loading matching bundle(s) only"
    for f in "${matched[@]}"; do
      load_one "$f"
    done
  else
    if ((${#archives[@]} > 1)); then
      echo "Warning: multiple bundles and no *-${arch:-unknown}.tar.gz match; loading all (last wins for :latest)." >&2
    fi
    for f in "${archives[@]}"; do
      load_one "$f"
    done
  fi
else
  echo "Not found: $TARGET" >&2
  exit 1
fi

echo ""
echo "Images loaded. Start the stack without rebuilding:"
echo "  cd $ROOT && ./compose.sh up --no-build"
