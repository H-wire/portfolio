#!/bin/sh

max_attempts=30
attempt=0

while [ "$attempt" -lt "$max_attempts" ]; do
  if curl -sf http://127.0.0.1:8001/health >/dev/null 2>&1; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

exit 1
