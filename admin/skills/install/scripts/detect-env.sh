#!/usr/bin/env bash
# Detect the current environment and output a JSON summary of available package managers.
# Used by admin:install to decide which install commands to run.

set -euo pipefail

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

# Determine environment type
if [[ "$OS" == "darwin" ]]; then
  ENV_TYPE="macos"
elif [[ "$OS" == "linux" ]]; then
  # Check if we're in a sandbox/container
  if [[ -f /.dockerenv ]] || grep -q 'docker\|lxc\|containerd' /proc/1/cgroup 2>/dev/null || [[ -d /sessions ]]; then
    ENV_TYPE="sandbox"
  else
    ENV_TYPE="linux-host"
  fi
elif [[ "$OS" == "mingw"* ]] || [[ "$OS" == "msys"* ]] || [[ "$OS" == "cygwin"* ]]; then
  ENV_TYPE="windows"
else
  ENV_TYPE="unknown"
fi

# Check for available package managers and tools
has_cmd() { command -v "$1" >/dev/null 2>&1; }

HAS_BREW=$(has_cmd brew && echo true || echo false)
HAS_APT=$(has_cmd apt-get && echo true || echo false)
HAS_PIP=$(has_cmd pip3 && echo true || (has_cmd pip && echo true || echo false))
HAS_NPM=$(has_cmd npm && echo true || echo false)
HAS_GIT=$(has_cmd git && echo true || echo false)
HAS_GO=$(has_cmd go && echo true || echo false)
HAS_PYTHON=$(has_cmd python3 && echo true || (has_cmd python && echo true || echo false))
HAS_NODE=$(has_cmd node && echo true || echo false)
SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"

# Get distro info on Linux
DISTRO=""
DISTRO_VERSION=""
if [[ "$OS" == "linux" ]] && [[ -f /etc/os-release ]]; then
  DISTRO=$(. /etc/os-release && echo "${ID:-unknown}")
  DISTRO_VERSION=$(. /etc/os-release && echo "${VERSION_ID:-unknown}")
fi

cat <<EOF
{
  "os": "${OS}",
  "env_type": "${ENV_TYPE}",
  "distro": "${DISTRO}",
  "distro_version": "${DISTRO_VERSION}",
  "has_brew": ${HAS_BREW},
  "has_apt": ${HAS_APT},
  "has_pip": ${HAS_PIP},
  "has_npm": ${HAS_NPM},
  "has_git": ${HAS_GIT},
  "has_go": ${HAS_GO},
  "has_python": ${HAS_PYTHON},
  "has_node": ${HAS_NODE},
  "shell": "${SHELL_NAME}"
}
EOF
