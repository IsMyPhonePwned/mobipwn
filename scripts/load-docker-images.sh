#!/usr/bin/env bash
# Load MobiPwn image bundle(s) built by ./scripts/build-docker-images.sh on another host.
#
# Usage:
#   ./scripts/load-docker-images.sh ./dist/mobipwn-images
#   ./scripts/load-docker-images.sh ./dist/mobipwn-images/mobipwn-images-1.0.0.tar.gz
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
Load MobiPwn Docker images exported by build-docker-images.sh.

Usage:
  ./scripts/load-docker-images.sh PATH

PATH may be a directory (loads all mobipwn-images-*.tar.gz) or a single .tar.gz file.
EOF
}

if [[ $# -lt 1 ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

TARGET="${1:?}"
shopt -s nullglob

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
  for f in "${archives[@]}"; do
    load_one "$f"
  done
else
  echo "Not found: $TARGET" >&2
  exit 1
fi

echo ""
echo "Images loaded. Start the stack without rebuilding:"
echo "  cd $ROOT && ./compose.sh up --no-build"
