#!/bin/bash
# Agent runner script - provides PTY for Claude CLI
AGENT_NAME="$1"
LOG_FILE="$2"
PROMPT="$3"
PROJECT_DIR="$4"

cd "$PROJECT_DIR"
export TD_AGENT_NAME="$AGENT_NAME"
export TD_DB_DIR="$PROJECT_DIR"

# Use unbuffer to provide PTY, pipe through tee for logging
exec unbuffer -p claude --dangerously-skip-permissions -p "$PROMPT" 2>&1 | tee -a "$LOG_FILE"
