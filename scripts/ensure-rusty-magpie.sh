#!/usr/bin/env bash
# Ensure mobipwn-web has a rusty_magpie binary: fetch prebuilt, build locally, or skip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BIN="$ROOT/mobipwn-web/public/vendor/rusty-magpie/rusty_magpie"
FETCH="$ROOT/scripts/fetch-rusty-magpie.sh"
BUILD="$ROOT/scripts/build-android-collector.sh"

# auto | fetch | build | skip
MODE="${MOBIPWN_RUSTY_MAGPIE_MODE:-auto}"
FORCE=0
BUILD_ARGS=()

usage() {
  cat <<'EOF'
Usage: ensure-rusty-magpie.sh [--force] [--with-yara]

Ensures mobipwn-web/public/vendor/rusty-magpie/rusty_magpie exists.

MOBIPWN_RUSTY_MAGPIE_MODE:
  auto   — fetch prebuilt if configured, else build when ANDROID_NDK_HOME is set, else skip
  fetch  — download only (fails if URL missing)
  build  — cross-compile with NDK only
  skip   — never fetch or build

Environment:
  RUSTY_MAGPIE_PREBUILT_URL      direct download URL (overrides prebuilt.json)
  RUSTY_MAGPIE_PREBUILT_SHA256   optional integrity check
  MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD=1  same as MODE=skip

EOF
}

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --with-yara) BUILD_ARGS+=(--with-yara) ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "${MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD:-}" == 1 ]]; then
  MODE=skip
fi

if [[ -f "$OUT_BIN" && "$FORCE" != 1 ]]; then
  echo "rusty_magpie already present at $OUT_BIN"
  exit 0
fi

fetch_args=()
[[ "$FORCE" == 1 ]] && fetch_args+=(--force)

can_fetch() {
  [[ -n "${RUSTY_MAGPIE_PREBUILT_URL:-}" ]] && return 0
  python3 - "$ROOT/mobipwn-web/public/vendor/rusty-magpie/prebuilt.json" <<'PY' 2>/dev/null
import json, sys, os
path = sys.argv[1]
if not os.path.isfile(path):
    sys.exit(1)
with open(path, encoding="utf-8") as f:
    m = json.load(f)
if m.get("url"):
    sys.exit(0)
if m.get("tag"):
    sys.exit(0)
sys.exit(1)
PY
}

can_build() {
  [[ -n "${ANDROID_NDK_HOME:-}" && -x "$BUILD" ]]
}

case "$MODE" in
  skip)
    echo "Skipping rusty_magpie (MOBIPWN_RUSTY_MAGPIE_MODE=skip)"
    exit 0
    ;;
  fetch)
    if ((${#fetch_args[@]})); then
      FORCE="$FORCE" "$FETCH" "${fetch_args[@]}"
    else
      FORCE="$FORCE" "$FETCH"
    fi
    ;;
  build)
    if ((${#BUILD_ARGS[@]})); then
      "$BUILD" "${BUILD_ARGS[@]}"
    else
      "$BUILD"
    fi
    ;;
  auto)
    if can_fetch; then
      if ((${#fetch_args[@]})); then
        if FORCE="$FORCE" "$FETCH" "${fetch_args[@]}"; then
          exit 0
        fi
      elif FORCE="$FORCE" "$FETCH"; then
        exit 0
      fi
      echo "WARNING: prebuilt fetch failed; trying local build if NDK is available" >&2
    fi
    if can_build; then
      if ((${#BUILD_ARGS[@]})); then
        "$BUILD" "${BUILD_ARGS[@]}"
      else
        "$BUILD"
      fi
      exit 0
    fi
    echo "WARNING: rusty_magpie missing — no prebuilt URL/tag and no ANDROID_NDK_HOME" >&2
    echo "         Run ./scripts/fetch-rusty-magpie.sh or ./scripts/build-android-collector.sh" >&2
    exit 0
    ;;
  *)
    echo "Unknown MOBIPWN_RUSTY_MAGPIE_MODE: $MODE" >&2
    exit 1
    ;;
esac
