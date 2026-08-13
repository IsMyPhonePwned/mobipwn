#!/usr/bin/env bash
# Build mobipwn-webadb (vendored WebUSB ADB) for the /collect page.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/mobipwn-webadb"
OUT="$ROOT/mobipwn-web/src/vendor/webadb"
MODE="${1:-dev}"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required — install: cargo install wasm-pack" >&2
  exit 1
fi

README_BACK=""
if [[ -f "$OUT/README.md" ]]; then
  README_BACK="$(mktemp)"
  cp "$OUT/README.md" "$README_BACK"
fi
DTS_BACK=""
if [[ -f "$OUT/webadb_rs.d.ts" ]]; then
  DTS_BACK="$(mktemp)"
  cp "$OUT/webadb_rs.d.ts" "$DTS_BACK"
fi

if [[ "$MODE" == "release" ]]; then
  wasm-pack build --release --target web --out-dir "$OUT" "$CRATE" -- --no-default-features --features webusb
else
  wasm-pack build --dev --target web --out-dir "$OUT" "$CRATE" -- --no-default-features --features webusb
fi

# wasm-pack writes a .gitignore that ignores everything in OUT; we track stubs via the repo root .gitignore.
rm -f "$OUT/.gitignore"
if [[ -n "$README_BACK" ]]; then
  cp "$README_BACK" "$OUT/README.md"
  rm -f "$README_BACK"
fi
if [[ -n "$DTS_BACK" ]]; then
  cp "$DTS_BACK" "$OUT/webadb_rs.d.ts"
  rm -f "$DTS_BACK"
fi

echo "Built webadb wasm → $OUT"
echo "If mobipwn-webadb changed, commit webadb_rs.js and webadb_rs_bg.wasm under mobipwn-web/src/vendor/webadb/"
