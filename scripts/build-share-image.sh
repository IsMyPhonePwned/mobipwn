#!/usr/bin/env bash
# Build MobiPwn Docker images for external share / offline transfer.
# Convenience wrapper around build-docker-images.sh (default export: ./dist/share).
#
# Usage:
#   ./scripts/build-share-image.sh
#   ./scripts/build-share-image.sh --platform linux/amd64 --tag 1.0.0
#   ./scripts/build-share-image.sh --registry ghcr.io/YOU/mobipwn --tag 1.0.0 --push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${MOBIPWN_IMAGE_TAG:-latest}"
REGISTRY=""
EXPORT_DIR="$ROOT/dist/share"
PLATFORM=""
PUSH=0
EXTRA=()

usage() {
  cat <<'EOF'
Build MobiPwn Docker images for external use / offline transfer.

Options (passed through to build-docker-images.sh):
  --tag TAG           Image tag (default: latest)
  --registry REG      Registry prefix for push
  --platform PLAT     e.g. linux/amd64
  --export DIR        Write .tar.gz under DIR (default: ./dist/share)
  --no-export         Build/tag only; skip tarball
  --push              Push to --registry
  --with-search       Also build mobipwn-search
  --no-jobs           Skip mobipwn-jobs
  -h, --help          Show this help

On a target host after copy:
  ./scripts/load-docker-images.sh ./dist/share
  ./compose.sh up --no-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --registry) REGISTRY="${2:?}"; shift 2 ;;
    --platform) PLATFORM="${2:?}"; shift 2 ;;
    --export) EXPORT_DIR="${2:?}"; shift 2 ;;
    --no-export) EXPORT_DIR=""; shift ;;
    --push) PUSH=1; shift ;;
    --with-search|--no-jobs) EXTRA+=("$1"); shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

args=(--tag "$TAG")
[[ -n "$REGISTRY" ]] && args+=(--registry "$REGISTRY")
[[ -n "$PLATFORM" ]] && args+=(--platform "$PLATFORM")
[[ -n "$EXPORT_DIR" ]] && args+=(--export "$EXPORT_DIR")
[[ "$PUSH" == 1 ]] && args+=(--push)
# Bash < 4.4 + set -u treats empty "${EXTRA[@]}" as unbound.
((${#EXTRA[@]})) && args+=("${EXTRA[@]}")

exec "$ROOT/scripts/build-docker-images.sh" "${args[@]}"
