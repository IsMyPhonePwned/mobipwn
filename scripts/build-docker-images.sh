#!/usr/bin/env bash
# Build MobiPwn application Docker images for deployment on another host (no compile on target).
#
# Two Dockerfiles are used:
#   docker/Dockerfile.rust  → mobipwn-api, mobipwn-jobs (and optional mobipwn-search)
#   mobipwn-web/Dockerfile  → mobipwn-web (nginx + static UI)
#
# Postgres and ClickHouse use upstream images (pulled on the target via compose).
#
# Usage:
#   ./scripts/build-docker-images.sh
#   ./scripts/build-docker-images.sh --export ./dist/mobipwn-images
#   ./scripts/build-docker-images.sh --platform linux/amd64 --tag 1.0.0 --export ./dist
#   ./scripts/build-docker-images.sh --registry ghcr.io/myorg/mobipwn --tag 1.0.0 --push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-lib.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-env.sh"

load_mobipwn_env "$ROOT"
apply_cargo_network_config "$ROOT"

COMPOSE_FILE="${MOBIPWN_COMPOSE_FILE:-$ROOT/docker-compose.stack.yml}"
COMPOSE_PROJECT="${MOBIPWN_COMPOSE_PROJECT:-mobipwn}"

ENGINE=""
container_cmd() {
  if [[ "$ENGINE" == docker ]]; then
    docker "$@"
  else
    podman "$@"
  fi
}

TAG="${MOBIPWN_IMAGE_TAG:-latest}"
REGISTRY=""
EXPORT_DIR=""
PLATFORM=""
PUSH=0
INCLUDE_SEARCH=0
SKIP_JOBS=0

usage() {
  cat <<'EOF'
Build MobiPwn Docker images for offline / remote deployment.

Options:
  --tag TAG           Image tag (default: latest, or MOBIPWN_IMAGE_TAG)
  --registry REG      Optional registry prefix, e.g. ghcr.io/myorg/mobipwn
  --platform PLAT     Target platform, e.g. linux/amd64 (for Mac → Linux servers)
  --export DIR        Save images as .tar.gz archives under DIR
  --push              Push tagged images to --registry (requires docker login)
  --with-search       Also build mobipwn-search (compose profile)
  --no-jobs           Skip mobipwn-jobs (API + web only)
  -h, --help          Show this help

Examples:
  ./scripts/build-docker-images.sh
  ./scripts/build-docker-images.sh --platform linux/amd64 --export ./dist/mobipwn-images
  ./scripts/load-docker-images.sh ./dist/mobipwn-images   # on the target host

On the target host (after copy + load):
  ./compose.sh up --no-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --registry) REGISTRY="${2:?}"; shift 2 ;;
    --platform) PLATFORM="${2:?}"; shift 2 ;;
    --export) EXPORT_DIR="${2:?}"; shift 2 ;;
    --push) PUSH=1; shift ;;
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

ENGINE="$(compose_engine)"

compose_image_name() {
  local service="$1"
  echo "${COMPOSE_PROJECT}-${service}"
}

publish_name() {
  local service="$1"
  if [[ -n "$REGISTRY" ]]; then
    echo "${REGISTRY%/}/${service}:${TAG}"
  else
    echo "$(compose_image_name "$service"):${TAG}"
  fi
}

SERVICES=(mobipwn-api mobipwn-web)
if [[ "$SKIP_JOBS" != 1 ]]; then
  SERVICES=(mobipwn-api mobipwn-jobs mobipwn-web)
fi
if [[ "$INCLUDE_SEARCH" == 1 ]]; then
  SERVICES+=(mobipwn-search)
fi

echo "==> Staging extractor libraries for Docker build"
"$ROOT/scripts/prepare-docker-deps.sh" || true

build_args=(-f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
if [[ -n "$PLATFORM" ]]; then
  export DOCKER_DEFAULT_PLATFORM="$PLATFORM"
  echo "==> Building for platform: $PLATFORM"
fi

echo "==> Building images: ${SERVICES[*]} (tag: $TAG)"
compose_cmd "${build_args[@]}" build "${SERVICES[@]}"

echo "==> Tagging images"
declare -a BUILT_IMAGES=()
for svc in "${SERVICES[@]}"; do
  src="$(compose_image_name "$svc"):latest"
  dst="$(publish_name "$svc")"
  if ! container_cmd image inspect "$src" >/dev/null 2>&1; then
    echo "Image not found after build: $src" >&2
    exit 1
  fi
  container_cmd tag "$src" "$dst"
  BUILT_IMAGES+=("$dst")
  if [[ "$TAG" != "latest" ]]; then
    container_cmd tag "$src" "$(compose_image_name "$svc"):${TAG}"
  fi
  echo "    $src → $dst"
done

if [[ -n "$EXPORT_DIR" ]]; then
  mkdir -p "$EXPORT_DIR"
  bundle="$EXPORT_DIR/mobipwn-images-${TAG}.tar.gz"
  declare -a SAVE_IMAGES=()
  for svc in "${SERVICES[@]}"; do
    latest="$(compose_image_name "$svc"):latest"
    container_cmd tag "$(publish_name "$svc")" "$latest"
    SAVE_IMAGES+=("$latest")
  done
  echo "==> Exporting ${#SAVE_IMAGES[@]} image(s) to $bundle"
  container_cmd save "${SAVE_IMAGES[@]}" | gzip -c >"$bundle"

  manifest="$EXPORT_DIR/README.txt"
  cat >"$manifest" <<EOF
MobiPwn Docker image bundle (tag: $TAG)
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platform: ${PLATFORM:-host default}

Images (compose-compatible :latest tags):
$(printf '  - %s\n' "${SAVE_IMAGES[@]}")

Load on target host (needs Docker or Podman):
  gunzip -c $(basename "$bundle") | docker load
  # or: ./scripts/load-docker-images.sh $(dirname "$bundle")

Start stack without rebuilding:
  ./compose.sh up --no-build

Postgres + ClickHouse are not in this bundle — compose pulls them on first start.
Copy this repo (or at least compose.sh, docker-compose.stack.yml, clickhouse/, .env) to the target.
EOF
  echo "==> Wrote $manifest"
fi

if [[ "$PUSH" == 1 ]]; then
  if [[ -z "$REGISTRY" ]]; then
    echo "--push requires --registry" >&2
    exit 1
  fi
  echo "==> Pushing images"
  for img in "${BUILT_IMAGES[@]}"; do
    container_cmd push "$img"
  done
fi

echo ""
echo "Done. Built images:"
printf '  %s\n' "${BUILT_IMAGES[@]}"
if [[ -n "$EXPORT_DIR" ]]; then
  echo ""
  echo "Copy $EXPORT_DIR to the target host, then:"
  echo "  ./scripts/load-docker-images.sh $EXPORT_DIR"
  echo "  ./compose.sh up --no-build"
fi
