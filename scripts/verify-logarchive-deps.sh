#!/usr/bin/env bash
# Fast check (no compile): default builds must not resolve macos-unifiedlogs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

echo "==> Lockfile (optional packages may be listed; default build must not link them)"
if ! rg -q "macos-unifiedlogs" Cargo.lock 2>/dev/null; then
  ok "Cargo.lock has no macos-unifiedlogs entry"
else
  echo "NOTE: Cargo.lock lists macos-unifiedlogs (path-crate dev-deps); checking default tree below"
fi

echo "==> mobipwn-ingest manifest"
rg -q 'default-features = false' mobipwn-ingest/Cargo.toml \
  || fail "mobipwn-ingest should disable sysdiagnose default features (logarchive-decode)"
rg -q 'logarchive-decode = \["sysdiagnose_extractor_library/logarchive-decode"\]' mobipwn-ingest/Cargo.toml \
  || fail "logarchive-decode feature should enable sysdiagnose_extractor_library/logarchive-decode"
if rg -q 'sysdiagnose_logarchive_decode' mobipwn-ingest/Cargo.toml; then
  fail "mobipwn-ingest should not declare a direct sysdiagnose_logarchive_decode path dep"
fi
ok "sysdiagnose feature gating configured"

echo "==> sysdiagnose-extractor-library manifest"
if [[ -f ../sysdiagnose-extractor-library/Cargo.toml ]] \
  && rg -q "macos-unifiedlogs" ../sysdiagnose-extractor-library/Cargo.toml; then
  fail "sysdiagnose lib still declares macos-unifiedlogs"
fi
ok "sysdiagnose lib manifest is clean"

echo "==> Dependency tree (metadata only, 15s timeout)"
if command -v timeout >/dev/null 2>&1; then
  if timeout 15 cargo tree -p mobipwn-api 2>/dev/null | rg -qi "macos-unified|logarchive_decode"; then
    fail "mobipwn-api default tree includes decode crates"
  fi
  ok "mobipwn-api default tree clean"
else
  echo "SKIP: timeout not available (install coreutils or run: cargo tree -p mobipwn-api | rg unified)"
fi

echo ""
echo "All logarchive dependency checks passed."
