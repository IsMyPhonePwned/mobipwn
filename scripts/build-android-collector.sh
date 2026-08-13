#!/usr/bin/env bash
# Cross-compile mobi-android-collector (rusty_magpie) for Android arm64.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/mobi-android-collector"
OUT_DIR="$ROOT/mobipwn-web/public/vendor/rusty-magpie"
OUT_BIN="$OUT_DIR/rusty_magpie"
TARGET="aarch64-linux-android"
WITH_YARA=0

for arg in "$@"; do
  case "$arg" in
    --with-yara) WITH_YARA=1 ;;
    --fetch)
      exec "$ROOT/scripts/fetch-rusty-magpie.sh" "${@:2}"
      ;;
    --help|-h)
      echo "Usage: $0 [--with-yara] [--fetch]"
      echo "Builds mobi-android-collector → mobipwn-web/public/vendor/rusty-magpie/rusty_magpie"
      echo ""
      echo "  --fetch   Download a prebuilt binary (see scripts/fetch-rusty-magpie.sh)"
      echo ""
      echo "To fetch or build automatically: ./scripts/ensure-rusty-magpie.sh"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "${MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD:-}" == 1 ]]; then
  echo "Skipping build (MOBIPWN_SKIP_RUSTY_MAGPIE_BUILD=1)" >&2
  exit 0
fi

if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ANDROID_NDK_HOME must point at your Android NDK (see mobi-android-collector/README.mobipwn.md)" >&2
  exit 1
fi

if ! command -v cargo-ndk >/dev/null 2>&1; then
  echo "cargo-ndk is required — install: cargo install cargo-ndk" >&2
  exit 1
fi

rustup target add "$TARGET" >/dev/null 2>&1 || true

FEATURES="ps,find"
if [[ "$WITH_YARA" == 1 ]]; then
  FEATURES="ps,find,yara"
fi

mkdir -p "$OUT_DIR"
export RUSTFLAGS="-Clink-arg=-z -Clink-arg=nostart-stop-gc"

echo "==> Building mobi-android-collector ($TARGET, features=$FEATURES)"
# cargo-ndk 3.x: cargo args follow options directly (no `--` separator).
if [[ "$WITH_YARA" == 1 ]]; then
  cargo ndk -t arm64-v8a --manifest-path "$CRATE/Cargo.toml" \
    build --release --features "$FEATURES"
else
  cargo ndk -t arm64-v8a --manifest-path "$CRATE/Cargo.toml" build --release
fi

cp "$CRATE/target/$TARGET/release/rusty_magpie" "$OUT_BIN"
chmod 755 "$OUT_BIN"

magic=$(xxd -p -l 4 "$OUT_BIN" 2>/dev/null || od -An -tx1 -N 4 "$OUT_BIN" | tr -d ' \n')
if [[ "$magic" != "7f454c46" ]]; then
  echo "ERROR: $OUT_BIN is not an ELF binary (magic=$magic, $(file -b "$OUT_BIN"))" >&2
  rm -f "$OUT_BIN"
  exit 1
fi

SIZE=$(du -h "$OUT_BIN" | cut -f1)
echo "Built android collector → $OUT_BIN ($SIZE, $(file -b "$OUT_BIN"))"
