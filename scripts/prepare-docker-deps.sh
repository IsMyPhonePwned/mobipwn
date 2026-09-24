#!/usr/bin/env bash
# Stage sibling Rust deps into docker/deps/ for image build (avoids git clone when present).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="$ROOT/docker/deps"
BUGREPORT_SRC="${BUGREPORT_EXTRACTOR_ROOT:-$ROOT/../bugreport-extractor-library}"
SYSDIAGNOSE_SRC="${SYSDIAGNOSE_EXTRACTOR_ROOT:-$ROOT/../sysdiagnose-extractor-library}"
FAKEMUSTACHE_SRC="${FAKEMUSTACHE_ROOT:-$ROOT/../fakeMustache}"

mkdir -p "$DEPS"

stage_one() {
  local name="$1"
  local src="$2"
  local dest="$DEPS/$name"
  if [[ ! -d "$src/.git" && ! -f "$src/Cargo.toml" ]]; then
    return 0
  fi
  echo "==> staging $name from $src"
  rm -rf "$dest"
  mkdir -p "$dest"
  # tar preserves symlinks; faster than cp -a for large trees. Skip build artifacts.
  (cd "$src" && tar cf - \
    --exclude='./target' \
    --exclude='./.git' \
    --exclude='./python/.venv' \
    .) | (cd "$dest" && tar xf -)
}

stage_one bugreport-extractor-library "$BUGREPORT_SRC"
stage_one sysdiagnose-extractor-library "$SYSDIAGNOSE_SRC"
stage_one fakeMustache "$FAKEMUSTACHE_SRC"
