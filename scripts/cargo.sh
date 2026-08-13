#!/usr/bin/env bash
# Run cargo with mobipwn .env + optional SSL workarounds (no full ./dev.sh required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-env.sh"
if [[ -f "$ROOT/.dev/ports.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.dev/ports.env"
  set +a
fi
load_mobipwn_env "$ROOT"
apply_cargo_network_config "$ROOT"
exec cargo "$@"
