#!/bin/bash
# td - Task Daemon for multi-agent coordination
# Usage: ./td <command> [args...]

export TD_DB_DIR="${TD_DB_DIR:-$(cd "$(dirname "$0")" && pwd)}"
FBSOURCE="/data/users/cssmith/fbsource"

# Run with buck, silencing build noise (stderr) but keeping binary output (stdout)
cd "$FBSOURCE"
buck2 run fbcode//cssmith/td:td 2>/dev/null -- "$@"
