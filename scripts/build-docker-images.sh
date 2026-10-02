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
#   ./scripts/build-docker-images.sh --platform amd64,arm64 --tag 1.0.0 --export ./dist
#   ./scripts/build-docker-images.sh --all-platforms --tag 1.0.0 --export ./dist
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
PLATFORM_SPEC=""
ALL_PLATFORMS=0
PUSH=0
INCLUDE_SEARCH=0
SKIP_JOBS=0

usage() {
  cat <<'EOF'
Build MobiPwn Docker images for offline / remote deployment.

Options:
  --tag TAG           Image tag (default: latest, or MOBIPWN_IMAGE_TAG)
  --registry REG      Optional registry prefix, e.g. ghcr.io/myorg/mobipwn
  --platform PLAT     Target platform(s). Comma-separated OK.
                        Aliases: x64|amd64|x86_64 → linux/amd64
                                 arm64|aarch64 → linux/arm64
  --all-platforms     Build linux/amd64 (x64) and linux/arm64
  --export DIR        Save images as .tar.gz archives under DIR
  --push              Push tagged images to --registry (requires docker login)
  --with-search       Also build mobipwn-search (compose profile)
  --no-jobs           Skip mobipwn-jobs (API + web only)
  -h, --help          Show this help

Examples:
  ./scripts/build-docker-images.sh --platform linux/amd64 --export ./dist/mobipwn-images
  ./scripts/build-docker-images.sh --all-platforms --tag 1.0.0 --export ./dist/share
  ./scripts/build-docker-images.sh --platform amd64,arm64 --tag 1.0.0 --export ./dist/share
  ./scripts/load-docker-images.sh ./dist/share   # on the target host (pick matching arch tarball)

On the target host (after copy + load):
  ./compose.sh up --no-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --registry) REGISTRY="${2:?}"; shift 2 ;;
    --platform) PLATFORM_SPEC="${2:?}"; shift 2 ;;
    --all-platforms) ALL_PLATFORMS=1; shift ;;
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

normalize_platform() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$raw" in
    x64|amd64|x86_64|linux/amd64) echo "linux/amd64" ;;
    arm64|aarch64|linux/arm64) echo "linux/arm64" ;;
    "") return 1 ;;
    *) echo "$1" ;;
  esac
}

platform_arch_suffix() {
  case "$1" in
    linux/amd64) echo "amd64" ;;
    linux/arm64) echo "arm64" ;;
    *) echo "${1//\//-}" ;;
  esac
}

compose_image_name() {
  local service="$1"
  echo "${COMPOSE_PROJECT}-${service}"
}

# publish_name SERVICE [ARCH_SUFFIX]
# With arch: registry/svc:tag-arch or project-svc:tag-arch
publish_name() {
  local service="$1"
  local arch_suffix="${2:-}"
  local tag="$TAG"
  if [[ -n "$arch_suffix" ]]; then
    tag="${TAG}-${arch_suffix}"
  fi
  if [[ -n "$REGISTRY" ]]; then
    echo "${REGISTRY%/}/${service}:${tag}"
  else
    echo "$(compose_image_name "$service"):${tag}"
  fi
}

SERVICES=(mobipwn-api mobipwn-web)
if [[ "$SKIP_JOBS" != 1 ]]; then
  SERVICES=(mobipwn-api mobipwn-jobs mobipwn-web)
fi
if [[ "$INCLUDE_SEARCH" == 1 ]]; then
  SERVICES+=(mobipwn-search)
fi

declare -a PLATFORMS=()
if [[ "$ALL_PLATFORMS" == 1 ]]; then
  PLATFORMS=("linux/amd64" "linux/arm64")
elif [[ -n "$PLATFORM_SPEC" ]]; then
  IFS=',' read -r -a _raw_plats <<<"$PLATFORM_SPEC"
  for p in "${_raw_plats[@]}"; do
    [[ -z "$p" ]] && continue
    PLATFORMS+=("$(normalize_platform "$p")")
  done
fi

# Empty PLATFORMS → one pass with host default platform.
MULTI=0
if ((${#PLATFORMS[@]} > 1)); then
  MULTI=1
elif ((${#PLATFORMS[@]} == 0)); then
  PLATFORMS=("")
fi

echo "==> Staging extractor libraries for Docker build"
"$ROOT/scripts/prepare-docker-deps.sh" || true

build_args=(-f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT")
declare -a BUILT_IMAGES=()
declare -a EXPORTED_BUNDLES=()
MANIFEST_PLATFORMS=()

build_for_platform() {
  local plat="$1"
  local arch=""
  local use_arch_tag=0

  if [[ -n "$plat" ]]; then
    export DOCKER_DEFAULT_PLATFORM="$plat"
    arch="$(platform_arch_suffix "$plat")"
    echo "==> Building for platform: $plat ($arch)"
  else
    unset DOCKER_DEFAULT_PLATFORM 2>/dev/null || true
    echo "==> Building for platform: host default"
  fi

  if [[ "$MULTI" == 1 ]]; then
    use_arch_tag=1
  fi

  echo "==> Building images: ${SERVICES[*]} (tag: $TAG${arch:+-$arch})"
  # Host/shell may have CARGO_HTTP_CHECK_REVOKE="" from compose leftovers; never forward that.
  unset CARGO_HTTP_CHECK_REVOKE GIT_SSL_NO_VERIFY 2>/dev/null || true
  # One service at a time: parallel api+jobs cargo compiles OOMs on typical Docker Desktop RAM.
  for svc in "${SERVICES[@]}"; do
    echo "==> Building $svc"
    compose_cmd "${build_args[@]}" build "$svc"
  done

  echo "==> Tagging images"
  local svc src dst
  for svc in "${SERVICES[@]}"; do
    src="$(compose_image_name "$svc"):latest"
    if [[ "$use_arch_tag" == 1 ]]; then
      dst="$(publish_name "$svc" "$arch")"
    else
      dst="$(publish_name "$svc")"
    fi
    if ! container_cmd image inspect "$src" >/dev/null 2>&1; then
      echo "Image not found after build: $src" >&2
      exit 1
    fi
    container_cmd tag "$src" "$dst"
    BUILT_IMAGES+=("$dst")
    if [[ "$TAG" != "latest" && "$use_arch_tag" != 1 ]]; then
      container_cmd tag "$src" "$(compose_image_name "$svc"):${TAG}"
    fi
    # Always keep compose-friendly :latest for single-platform / last multi build.
    echo "    $src → $dst"
  done

  if [[ -n "$EXPORT_DIR" ]]; then
    mkdir -p "$EXPORT_DIR"
    local bundle_name="mobipwn-images-${TAG}"
    if [[ "$use_arch_tag" == 1 ]]; then
      bundle_name="mobipwn-images-${TAG}-${arch}"
    elif [[ -n "$arch" ]]; then
      # Single explicit platform: include arch in filename for clarity (x64 vs arm64).
      bundle_name="mobipwn-images-${TAG}-${arch}"
    fi
    local bundle="$EXPORT_DIR/${bundle_name}.tar.gz"
    declare -a SAVE_IMAGES=()
    for svc in "${SERVICES[@]}"; do
      local latest
      latest="$(compose_image_name "$svc"):latest"
      # Ensure :latest matches what we just built for this platform.
      container_cmd tag "$latest" "$latest"
      SAVE_IMAGES+=("$latest")
    done
    echo "==> Exporting ${#SAVE_IMAGES[@]} image(s) to $bundle"
    container_cmd save "${SAVE_IMAGES[@]}" | gzip -c >"$bundle"
    EXPORTED_BUNDLES+=("$bundle")
    MANIFEST_PLATFORMS+=("${plat:-host default}")
  fi

  if [[ "$PUSH" == 1 ]]; then
    if [[ -z "$REGISTRY" ]]; then
      echo "--push requires --registry" >&2
      exit 1
    fi
    echo "==> Pushing images ($plat)"
    for svc in "${SERVICES[@]}"; do
      local img
      if [[ "$use_arch_tag" == 1 ]]; then
        img="$(publish_name "$svc" "$arch")"
      else
        img="$(publish_name "$svc")"
      fi
      container_cmd push "$img"
    done
  fi
}

for plat in "${PLATFORMS[@]}"; do
  build_for_platform "$plat"
done

package_share_archive() {
  # One outer archive: deploy kit + docker image tarball (single file to copy).
  local image_bundle="$1"
  local plat_label="$2"
  local arch="$3"
  local stage_name="mobipwn-share-${TAG}"
  [[ -n "$arch" ]] && stage_name="mobipwn-share-${TAG}-${arch}"

  local stage="$EXPORT_DIR/${stage_name}"
  local out="$EXPORT_DIR/${stage_name}.tar.gz"

  rm -rf "$stage"
  mkdir -p "$stage/clickhouse/config.d"
  cp -a "$ROOT/deploy/docker-compose.yml" "$ROOT/deploy/.env.example" \
    "$ROOT/deploy/run.sh" "$ROOT/deploy/stop.sh" "$ROOT/deploy/status.sh" \
    "$ROOT/deploy/lib-compose.sh" "$stage/"
  cp -a "$ROOT/scripts/host-ports.sh" "$stage/lib-host-ports.sh"
  cp -a "$ROOT/clickhouse/init.sql" "$stage/clickhouse/"
  cp -a "$ROOT/clickhouse/config.d/dev-low-cpu.xml" "$stage/clickhouse/config.d/"
  chmod +x "$stage/run.sh" "$stage/stop.sh" "$stage/status.sh"
  cp -a "$image_bundle" "$stage/$(basename "$image_bundle")"

  cat >"$stage/README.txt" <<EOF
MobiPwn offline share package (tag: $TAG)
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platform: $plat_label

Run (no git clone):
  tar xzf ${stage_name}.tar.gz
  cd ${stage_name}
  ./run.sh       # start
  ./status.sh    # containers + health
  ./stop.sh      # stop (keep data)

Web UI: http://127.0.0.1:8080/   API: http://127.0.0.1:3000/health
Postgres + ClickHouse are pulled from Docker Hub on first start.
EOF

  echo "==> Creating share archive $out"
  tar -C "$EXPORT_DIR" -czf "$out" "${stage_name}"
  rm -rf "$stage"
  rm -f "$image_bundle"
  echo "==> Wrote $out"
  SHARE_ARCHIVES+=("$out")
}

arch_from_image_bundle() {
  local base
  base="$(basename "$1")"
  # mobipwn-images-1.0.0-amd64.tar.gz → amd64
  if [[ "$base" =~ ^mobipwn-images-.+-([a-z0-9_]+)\.tar\.gz$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  echo ""
}

declare -a SHARE_ARCHIVES=()

if [[ -n "$EXPORT_DIR" && ${#EXPORTED_BUNDLES[@]} -gt 0 ]]; then
  mkdir -p "$EXPORT_DIR"
  for i in "${!EXPORTED_BUNDLES[@]}"; do
    img_bundle="${EXPORTED_BUNDLES[$i]}"
    plat_label="${MANIFEST_PLATFORMS[$i]}"
    arch_suf="$(arch_from_image_bundle "$img_bundle")"
    package_share_archive "$img_bundle" "$plat_label" "$arch_suf"
  done

  {
    echo "MobiPwn share packages (tag: $TAG)"
    echo "Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo ""
    echo "Copy ONE archive to the target (images + run kit included):"
    for a in "${SHARE_ARCHIVES[@]}"; do
      echo "  - $(basename "$a")"
    done
    echo ""
    echo "On the target:"
    echo "  tar xzf mobipwn-share-${TAG}-amd64.tar.gz"
    echo "  cd mobipwn-share-${TAG}-amd64"
    echo "  ./run.sh"
  } >"$EXPORT_DIR/README.txt"
  echo "==> Wrote $EXPORT_DIR/README.txt"
fi

echo ""
echo "Done. Built images:"
printf '  %s\n' "${BUILT_IMAGES[@]}"
if [[ -n "$EXPORT_DIR" && ${#SHARE_ARCHIVES[@]} -gt 0 ]]; then
  echo ""
  echo "Share archives (copy one file to the target):"
  printf '  %s\n' "${SHARE_ARCHIVES[@]}"
  first="$(basename "${SHARE_ARCHIVES[0]}")"
  echo ""
  echo "On the target:"
  echo "  tar xzf $first"
  echo "  cd ${first%.tar.gz}"
  echo "  ./run.sh"
fi
