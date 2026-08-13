#!/usr/bin/env bash
# Stage bugreport/sysdiagnose extractor repos into docker/deps/ for image build (avoids git clone when siblings exist).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="$ROOT/docker/deps"
BUGREPORT_SRC="${BUGREPORT_EXTRACTOR_ROOT:-$ROOT/../bugreport-extractor-library}"
SYSDIAGNOSE_SRC="${SYSDIAGNOSE_EXTRACTOR_ROOT:-$ROOT/../sysdiagnose-extractor-library}"

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
  # tar preserves symlinks; faster than cp -a for large trees.
  (cd "$src" && tar cf - .) | (cd "$dest" && tar xf -)
}

stage_one bugreport-extractor-library "$BUGREPORT_SRC"
stage_one sysdiagnose-extractor-library "$SYSDIAGNOSE_SRC"
