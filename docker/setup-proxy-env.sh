#!/bin/sh
# Configure HTTP(S) proxy for apt, curl, git, npm, cargo inside Docker build/runtime.
# No-op when HTTP_PROXY is unset or empty.
set -e

proxy="${HTTP_PROXY:-}"
proxy="${proxy#"${proxy%%[![:space:]]*}"}"
proxy="${proxy%"${proxy##*[![:space:]]}"}"

if [ -z "$proxy" ]; then
  exit 0
fi

https_proxy="${HTTPS_PROXY:-$proxy}"
no_proxy="${NO_PROXY:-localhost,127.0.0.1}"

export HTTP_PROXY="$proxy"
export HTTPS_PROXY="$https_proxy"
export NO_PROXY="$no_proxy"
export http_proxy="$proxy"
export https_proxy="$https_proxy"
export no_proxy="$no_proxy"

if [ -d /etc/apt/apt.conf.d ]; then
  # apt ignores HTTP_PROXY env; write apt.conf fragment.
  {
    printf 'Acquire::http::Proxy "%s";\n' "$proxy"
    printf 'Acquire::https::Proxy "%s";\n' "$https_proxy"
  } > /etc/apt/apt.conf.d/99-mobipwn-proxy.conf
fi

echo "mobipwn: proxy enabled (${proxy})"
