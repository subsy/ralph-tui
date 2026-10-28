#!/bin/sh
# ABOUTME: Fixture Droid command for testing process exit and stdio drain handling.

set -eu

printf '%s\n' 'droid fixture output'

if [ "${DROID_FIXTURE_MODE:-clean}" = 'hold' ]; then
  trap '' HUP
  sleep 30 &
  if [ -n "${AGENT_CHILD_PID_FILE:-}" ]; then
    printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
  fi
fi
