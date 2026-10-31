#!/bin/sh
# ABOUTME: Fixture Droid command for testing process exit and stdio drain handling.

set -eu

printf '%s\n' 'droid fixture output'
printf '%s\n' 'droid fixture stderr' >&2

if [ "${DROID_FIXTURE_MODE:-clean}" = 'hold' ]; then
  trap '' HUP
  sleep 30 &
  if [ -n "${AGENT_CHILD_PID_FILE:-}" ]; then
    printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
  fi
fi

case "${DROID_FIXTURE_MODE:-clean}" in
  burst|continuous)
    trap '' HUP
    (
      if [ "$DROID_FIXTURE_MODE" = 'burst' ]; then
        sleep 1.5
        printf '%s\n' 'burst output'
        printf '%s\n' 'late stderr' >&2
        sleep 30
      else
        while :; do
          sleep 0.3
          printf '%s\n' 'continuous output'
        done
      fi
    ) &
    printf '%s\n' "$!" > "$AGENT_CHILD_PID_FILE"
    ;;
  timeout|interrupt|interrupt-all|early-interrupt)
    exec sleep 30
    ;;
  fail)
    exit 7
    ;;
  large)
    head -c 2000100 /dev/zero | tr '\000' x
    printf '%s' 'stdout-tail'
    head -c 2000100 /dev/zero | tr '\000' y >&2
    printf '%s' 'stderr-tail' >&2
    ;;
esac
