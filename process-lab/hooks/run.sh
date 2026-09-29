#!/bin/sh
exec python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" hook "$1"
