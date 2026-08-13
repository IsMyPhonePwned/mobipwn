#!/usr/bin/env bash
# Detect docker compose or podman compose (sourced by compose.sh).
set -euo pipefail

compose_engine() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo docker
    return 0
  fi
  if command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    echo podman
    return 0
  fi
  return 1
}

compose_cmd() {
  local engine
  engine="$(compose_engine)" || {
    echo "Need Docker Compose or Podman Compose (docker compose / podman compose)." >&2
    exit 1
  }
  if [[ "$engine" == docker ]]; then
    docker compose "$@"
  else
    podman compose "$@"
  fi
}
