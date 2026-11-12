#!/bin/sh
# Download the current clickhouse build of the 26.10 branch (macOS arm64/x86_64, Linux)
# into ./bin. Branch builds are not checksum-pinned; the version prints at the end.
# Same source as https://clickhouse.com/ install script, without its extra installs.
set -eu
VERSION_BRANCH="${CLICKHOUSE_BRANCH:-26.10}"
cd "$(dirname "$0")"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) DIR=macos-aarch64 ;;
  Darwin-x86_64) DIR=macos ;;
  Linux-x86_64) DIR=amd64 ;;
  Linux-aarch64) DIR=aarch64 ;;
  *) echo "unsupported platform $(uname -sm)" >&2; exit 2 ;;
esac
mkdir -p bin
curl -fSL "https://builds.clickhouse.com/${VERSION_BRANCH}/${DIR}/clickhouse" -o bin/clickhouse
chmod +x bin/clickhouse
bin/clickhouse local --version
