#!/bin/sh
# ABOUTME: Fixture agent for testing process exit and stdio drain handling.

set -eu

mode="${1:-clean}"

case "$mode" in
  clean)
    printf '%s\n' 'clean output'
    ;;
  hold)
    printf '%s\n' 'initial output'
    sleep 30 &
    if [ -n "${AGENT_CHILD_PID_FILE:-}" ]; then
      printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
    fi
    ;;
  burst)
    printf '%s\n' 'initial output'
    (
      sleep 1.5
      printf '%s\n' 'burst output'
      sleep 30
    ) &
    if [ -n "${AGENT_CHILD_PID_FILE:-}" ]; then
      printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
    fi
    ;;
  continuous)
    printf '%s\n' 'initial output'
    (
      while :; do
        sleep 0.3
        printf '%s\n' 'continuous output'
      done
    ) &
    if [ -n "${AGENT_CHILD_PID_FILE:-}" ]; then
      printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
    fi
    ;;
  *)
    printf 'unknown mode: %s\n' "$mode" >&2
    exit 1
    ;;
esac
