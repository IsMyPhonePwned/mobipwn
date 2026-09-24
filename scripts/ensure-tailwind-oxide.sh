#!/usr/bin/env bash
# Tailwind v4 uses platform-specific @tailwindcss/oxide-* optional deps. npm often skips
# them when Node is <20 (engine mismatch) or due to optional-deps bugs — install if missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${MOBIPWN_WEB_DIR:-$ROOT/mobipwn-web}"
OXIDE="$WEB/node_modules/@tailwindcss/oxide"

[[ -d "$OXIDE" ]] || exit 0

# Alpine / musl vs glibc (Tailwind ships separate *-musl / *-gnu packages).
linux_libc_suffix() {
  if [[ -f /etc/alpine-release ]] \
    || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; } \
    || [[ "$(ldd /bin/sh 2>&1 || true)" == *musl* ]]; then
    echo musl
  else
    echo gnu
  fi
}

oxide_platform_pkg() {
  local libc
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      libc="$(linux_libc_suffix)"
      echo "@tailwindcss/oxide-linux-x64-${libc}"
      ;;
    Linux-aarch64 | Linux-arm64)
      libc="$(linux_libc_suffix)"
      echo "@tailwindcss/oxide-linux-arm64-${libc}"
      ;;
    Linux-armv7l) echo "@tailwindcss/oxide-linux-arm-gnueabihf" ;;
    Darwin-arm64) echo "@tailwindcss/oxide-darwin-arm64" ;;
    Darwin-x86_64) echo "@tailwindcss/oxide-darwin-x64" ;;
    MINGW*-x86_64 | MSYS*-x86_64 | CYGWIN*-x86_64) echo "@tailwindcss/oxide-win32-x64-msvc" ;;
    *) return 1 ;;
  esac
}

VER="$(node -p "require('$OXIDE/package.json').version")"
PKG="$(oxide_platform_pkg)" || exit 0
PKG_DIR="$WEB/node_modules/$PKG"

if [[ -d "$PKG_DIR" ]]; then
  exit 0
fi

echo "==> Installing ${PKG}@${VER} (Tailwind CSS native binding for $(uname -s)/$(uname -m))"
(cd "$WEB" && npm install "${PKG}@${VER}" --no-save --no-fund --no-audit)
