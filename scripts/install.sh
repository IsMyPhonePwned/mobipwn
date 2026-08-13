#!/usr/bin/env bash
# mobipwn production install — full Docker/Podman stack (see ./compose.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/compose.sh" up "$@"
