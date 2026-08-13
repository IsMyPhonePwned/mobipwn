#!/usr/bin/env bash
# Download a prebuilt rusty_magpie binary (GitHub release or direct URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/mobipwn-web/public/vendor/rusty-magpie"
OUT_BIN="$OUT_DIR/rusty_magpie"
MANIFEST="$OUT_DIR/prebuilt.json"

usage() {
  cat <<'EOF'
Usage: fetch-rusty-magpie.sh [--force]

Downloads mobi-android-collector (rusty_magpie) for aarch64-linux-android.

URL resolution (first match wins):
  1. RUSTY_MAGPIE_PREBUILT_URL
  2. prebuilt.json "url" field
  3. prebuilt.json repository + tag + asset → GitHub release asset

Optional integrity check:
  RUSTY_MAGPIE_PREBUILT_SHA256 or prebuilt.json "sha256"

EOF
}

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -f "$OUT_BIN" && "$FORCE" != 1 ]]; then
  echo "rusty_magpie already present at $OUT_BIN ($(du -h "$OUT_BIN" | cut -f1))"
  exit 0
fi

resolve_url() {
  if [[ -n "${RUSTY_MAGPIE_PREBUILT_URL:-}" ]]; then
    echo "$RUSTY_MAGPIE_PREBUILT_URL"
    return 0
  fi
  if [[ ! -f "$MANIFEST" ]]; then
    return 1
  fi
  python3 - "$MANIFEST" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    m = json.load(f)
if u := m.get("url"):
    print(u)
    sys.exit(0)
repo = m.get("repository") or "ismyphonepwned/mobipwn"
tag = m.get("tag")
asset = m.get("asset") or "rusty_magpie-aarch64-linux-android"
if tag:
    print(f"https://github.com/{repo}/releases/download/{tag}/{asset}")
    sys.exit(0)
sys.exit(1)
PY
}

resolve_sha256() {
  if [[ -n "${RUSTY_MAGPIE_PREBUILT_SHA256:-}" ]]; then
    echo "$RUSTY_MAGPIE_PREBUILT_SHA256"
    return 0
  fi
  if [[ ! -f "$MANIFEST" ]]; then
    return 1
  fi
  python3 - "$MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    m = json.load(f)
if h := m.get("sha256"):
    print(h)
    sys.exit(0)
sys.exit(1)
PY
}

URL="$(resolve_url || true)"
if [[ -z "$URL" ]]; then
  echo "No prebuilt URL configured." >&2
  echo "Set RUSTY_MAGPIE_PREBUILT_URL or edit $MANIFEST (tag or url)." >&2
  echo "Publish with: ./scripts/publish-rusty-magpie.sh <version>" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP="${OUT_BIN}.download.$$"
trap 'rm -f "$TMP"' EXIT

echo "==> Fetching rusty_magpie"
echo "    $URL"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 --retry-delay 2 -o "$TMP" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$TMP" "$URL"
else
  echo "curl or wget is required to download prebuilt binaries" >&2
  exit 1
fi

EXPECTED_SHA="$(resolve_sha256 || true)"
if [[ -n "$EXPECTED_SHA" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA="$(sha256sum "$TMP" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA="$(shasum -a 256 "$TMP" | awk '{print $1}')"
  else
    echo "WARNING: cannot verify sha256 (no sha256sum/shasum)" >&2
    ACTUAL_SHA=""
  fi
  if [[ -n "${ACTUAL_SHA:-}" && "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
    echo "ERROR: sha256 mismatch (expected $EXPECTED_SHA, got $ACTUAL_SHA)" >&2
    exit 1
  fi
  echo "    sha256 ok ($ACTUAL_SHA)"
fi

magic=$(xxd -p -l 4 "$TMP" 2>/dev/null || od -An -tx1 -N 4 "$TMP" | tr -d ' \n')
if [[ "$magic" != "7f454c46" ]]; then
  echo "ERROR: download is not an ELF binary (magic=$magic)" >&2
  exit 1
fi

mv "$TMP" "$OUT_BIN"
chmod 755 "$OUT_BIN"
trap - EXIT

SIZE=$(du -h "$OUT_BIN" | cut -f1)
echo "Fetched android collector → $OUT_BIN ($SIZE, $(file -b "$OUT_BIN" 2>/dev/null || echo ELF))"
