#!/usr/bin/env bash
# Build rusty_magpie locally and upload to a GitHub release; update prebuilt.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BIN="$ROOT/mobipwn-web/public/vendor/rusty-magpie/rusty_magpie"
MANIFEST="$ROOT/mobipwn-web/public/vendor/rusty-magpie/prebuilt.json"
ASSET_NAME="rusty_magpie-aarch64-linux-android"
WITH_YARA=0

usage() {
  cat <<'EOF'
Usage: publish-rusty-magpie.sh <version> [--with-yara] [--repo owner/name] [--dry-run]

Builds mobi-android-collector, creates GitHub release rusty-magpie-<version>,
uploads the binary, and updates prebuilt.json with tag + sha256.

Requires: ANDROID_NDK_HOME, cargo-ndk, gh (GitHub CLI).

Examples:
  ./scripts/publish-rusty-magpie.sh 0.1.0
  ./scripts/publish-rusty-magpie.sh 0.1.0 --repo ismyphonepwned/mobipwn

EOF
}

VERSION=""
REPO="${MOBIPWN_GITHUB_REPO:-ismyphonepwned/mobipwn}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-yara) WITH_YARA=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$VERSION" ]]; then
        VERSION="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  usage >&2
  exit 1
fi

TAG="rusty-magpie-v${VERSION#v}"
RELEASE_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"

build_args=()
[[ "$WITH_YARA" == 1 ]] && build_args+=(--with-yara)
if ((${#build_args[@]})); then
  "$ROOT/scripts/build-android-collector.sh" "${build_args[@]}"
else
  "$ROOT/scripts/build-android-collector.sh"
fi

if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$OUT_BIN" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$OUT_BIN" | awk '{print $1}')"
else
  echo "sha256sum or shasum required" >&2
  exit 1
fi

echo "==> Binary: $OUT_BIN"
echo "    sha256: $SHA256"
echo "    release tag: $TAG"
echo "    asset: $ASSET_NAME"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run — not creating release)"
else
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh (GitHub CLI) is required — https://cli.github.com/" >&2
    exit 1
  fi
  NOTES_FILE="$(mktemp)"
  cat >"$NOTES_FILE" <<EOF
Prebuilt Rusty Magpie (mobi-android-collector) for Mobipwn /collect.

- Target: aarch64-linux-android (arm64-v8a)
- Features: ps, find$([[ "$WITH_YARA" == 1 ]] && echo ", yara")
- sha256: \`${SHA256}\`

Download and place at \`mobipwn-web/public/vendor/rusty-magpie/rusty_magpie\`, or run:

\`\`\`bash
RUSTY_MAGPIE_PREBUILT_URL=${RELEASE_URL} ./scripts/fetch-rusty-magpie.sh
\`\`\`
EOF
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "==> Uploading to existing release $TAG"
    gh release upload "$TAG" "$OUT_BIN#$ASSET_NAME" --repo "$REPO" --clobber
  else
    echo "==> Creating release $TAG"
    gh release create "$TAG" "$OUT_BIN#$ASSET_NAME" \
      --repo "$REPO" \
      --title "Rusty Magpie v${VERSION#v}" \
      --notes-file "$NOTES_FILE"
  fi
  rm -f "$NOTES_FILE"
fi

python3 - "$MANIFEST" "$REPO" "$TAG" "$ASSET_NAME" "$SHA256" <<'PY'
import json, sys
path, repo, tag, asset, sha = sys.argv[1:6]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data.update({
    "repository": repo,
    "tag": tag,
    "asset": asset,
    "url": None,
    "sha256": sha,
})
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"Updated {path}")
PY

echo "Done. Users can run: ./scripts/fetch-rusty-magpie.sh"
echo "Release URL: $RELEASE_URL"
