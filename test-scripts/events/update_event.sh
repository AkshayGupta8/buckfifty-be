#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <event_id>" >&2
  exit 1
fi

EVENT_ID="${REMAINING_ARGS[0]}"

# Update event by ID
curl -X PUT "$BASE_URL/events/$EVENT_ID" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Updated Test Event",
  "description": "This is an updated test event",
  "start_time": "2025-12-01T11:00:00Z",
  "end_time": "2025-12-01T13:00:00Z"
}'
