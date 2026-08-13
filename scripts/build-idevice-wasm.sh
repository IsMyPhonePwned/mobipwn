#!/usr/bin/env bash
# Build idevice-rs WASM (WebUSB Apple lockdown) for /collect and advanced pages.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDEVICE_ROOT="${IDEVICE_RS_ROOT:-$(cd "$ROOT/../idevice-rs" 2>/dev/null && pwd || true)}"
OUT="$ROOT/mobipwn-web/src/vendor/idevice"
MODE="${1:-dev}"

if [[ -z "${IDEVICE_ROOT:-}" || ! -d "$IDEVICE_ROOT/crates/idevice-wasm" ]]; then
  echo "idevice-rs not found. Set IDEVICE_RS_ROOT or clone next to mobipwn:" >&2
  echo "  git clone https://github.com/ping2A/idevice-rs ../idevice-rs" >&2
  exit 1
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required — install: cargo install wasm-pack" >&2
  exit 1
fi

rustup target list --installed | grep -q 'wasm32-unknown-unknown' \
  || rustup target add wasm32-unknown-unknown

# ring needs a clang that understands wasm32 (Apple clang does not).
if [[ -z "${CC:-}" ]]; then
  if command -v brew >/dev/null 2>&1; then
    LLVM_PREFIX="$(brew --prefix llvm 2>/dev/null || true)"
    if [[ -n "$LLVM_PREFIX" && -x "$LLVM_PREFIX/bin/clang" ]]; then
      export PATH="$LLVM_PREFIX/bin:$PATH"
      export CC="$LLVM_PREFIX/bin/clang"
      export AR="$LLVM_PREFIX/bin/llvm-ar"
      # Prefer this clang for the wasm32 cross-compile even if PATH has Apple clang first.
      export CC_wasm32_unknown_unknown="$LLVM_PREFIX/bin/clang"
      export AR_wasm32_unknown_unknown="$LLVM_PREFIX/bin/llvm-ar"
    fi
  fi
fi
if [[ -n "${CC:-}" && ! -x "$CC" ]]; then
  echo "CC=$CC is not executable. Install LLVM (brew install llvm) or unset CC." >&2
  exit 1
fi
if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ -z "${CC:-}" ]] || ! "$CC" --target=wasm32-unknown-unknown -c -x c /dev/null -o /tmp/mobipwn-wasm-cc-test.o >/dev/null 2>&1; then
    rm -f /tmp/mobipwn-wasm-cc-test.o
    echo "idevice-wasm needs LLVM clang with wasm32 support (Apple clang cannot build ring)." >&2
    echo "  brew install llvm" >&2
    echo "Then re-run: ./scripts/build-idevice-wasm.sh release" >&2
    echo "(./dev.sh rebuilds this automatically once LLVM is installed.)" >&2
    exit 1
  fi
  rm -f /tmp/mobipwn-wasm-cc-test.o
fi

mkdir -p "$OUT"
README_BACK=""
if [[ -f "$OUT/README.md" ]]; then
  README_BACK="$(mktemp)"
  cp "$OUT/README.md" "$README_BACK"
fi
DTS_BACK=""
if [[ -f "$OUT/idevice_wasm.d.ts" ]]; then
  DTS_BACK="$(mktemp)"
  cp "$OUT/idevice_wasm.d.ts" "$DTS_BACK"
fi

if [[ "$MODE" == "release" ]]; then
  wasm-pack build --release --target web --out-dir "$OUT" "$IDEVICE_ROOT/crates/idevice-wasm"
else
  wasm-pack build --dev --target web --out-dir "$OUT" "$IDEVICE_ROOT/crates/idevice-wasm"
fi

rm -f "$OUT/.gitignore" "$OUT/package.json" "$OUT/.npmignore"
if [[ -n "$README_BACK" ]]; then
  cp "$README_BACK" "$OUT/README.md"
  rm -f "$README_BACK"
fi
if [[ -n "$DTS_BACK" && ! -f "$OUT/idevice_wasm.d.ts" ]]; then
  cp "$DTS_BACK" "$OUT/idevice_wasm.d.ts"
  rm -f "$DTS_BACK"
elif [[ -n "$DTS_BACK" ]]; then
  rm -f "$DTS_BACK"
fi

echo "Built idevice wasm → $OUT"
echo "Commit idevice_wasm.js and idevice_wasm_bg.wasm under mobipwn-web/src/vendor/idevice/ when ready."
