#!/usr/bin/env bash
# Sync mobipwn-webadb core from the working webadb-rs sibling repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${WEBADB_RS_ROOT:-$HOME/Code/ismyphonepwned/webadb-rs}"
DST="$ROOT/mobipwn-webadb"

if [[ ! -d "$SRC/src" ]]; then
  echo "webadb-rs not found at $SRC" >&2
  echo "Set WEBADB_RS_ROOT or clone to ~/Code/ismyphonepwned/webadb-rs" >&2
  exit 1
fi

for file in client.rs transport.rs protocol.rs auth.rs sync.rs lib.rs wasm.rs; do
  if [[ -f "$SRC/src/$file" ]]; then
    cp "$SRC/src/$file" "$DST/src/$file"
    echo "Synced $file"
  fi
done

echo "Done. Rebuild wasm: ./scripts/build-webadb-wasm.sh"
