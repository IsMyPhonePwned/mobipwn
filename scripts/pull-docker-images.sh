#!/usr/bin/env bash
# Pull MobiPwn images from a container registry and retag for ./compose.sh up --no-build.
#
# Usage:
#   ./scripts/pull-docker-images.sh --registry ghcr.io/myorg/mobipwn --tag 1.0.0
#   MOBIPWN_IMAGE_REGISTRY=ghcr.io/myorg/mobipwn MOBIPWN_IMAGE_TAG=latest ./scripts/pull-docker-images.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-lib.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-env.sh"

load_mobipwn_env "$ROOT"

COMPOSE_PROJECT="${MOBIPWN_COMPOSE_PROJECT:-mobipwn}"
REGISTRY="${MOBIPWN_IMAGE_REGISTRY:-}"
TAG="${MOBIPWN_IMAGE_TAG:-latest}"
INCLUDE_SEARCH=0
SKIP_JOBS=0

usage() {
  cat <<'EOF'
Pull MobiPwn images from a registry and tag them for docker compose.

Options:
  --registry REG   Registry prefix, e.g. ghcr.io/myorg/mobipwn (or MOBIPWN_IMAGE_REGISTRY)
  --tag TAG        Image tag (default: latest, or MOBIPWN_IMAGE_TAG)
  --with-search    Also pull mobipwn-search
  --no-jobs          Skip mobipwn-jobs
  -h, --help       Show this help

Then start:
  ./compose.sh up --no-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="${2:?}"; shift 2 ;;
    --tag) TAG="${2:?}"; shift 2 ;;
    --with-search) INCLUDE_SEARCH=1; shift ;;
    --no-jobs) SKIP_JOBS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$REGISTRY" ]]; then
  echo "Set --registry or MOBIPWN_IMAGE_REGISTRY" >&2
  exit 1
fi

ENGINE="$(compose_engine)"
pull_cmd() {
  if [[ "$ENGINE" == docker ]]; then
    docker pull "$1"
    docker tag "$1" "$2"
  else
    podman pull "$1"
    podman tag "$1" "$2"
  fi
}

SERVICES=(mobipwn-api mobipwn-web)
if [[ "$SKIP_JOBS" != 1 ]]; then
  SERVICES=(mobipwn-api mobipwn-jobs mobipwn-web)
fi
if [[ "$INCLUDE_SEARCH" == 1 ]]; then
  SERVICES+=(mobipwn-search)
fi

echo "==> Pulling from ${REGISTRY%/} (tag: $TAG)"
for svc in "${SERVICES[@]}"; do
  remote="${REGISTRY%/}/${svc}:${TAG}"
  local="${COMPOSE_PROJECT}-${svc}:latest"
  echo "    $remote → $local"
  pull_cmd "$remote" "$local"
done

echo ""
echo "Done. Start stack:"
echo "  ./compose.sh up --no-build"
