#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

# Create a new event
curl -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d '{
  "created_by_user_id": "11a36ba3-06bb-4a73-8788-85180522fe78",
  "activity_id": "24f18a8e-0f62-41fc-9512-458d1209fa71",
  "location": "Boulder",
  "max_participants": 10,
  "timeSlots": {
    "create": [
      {
        "start_time": "2025-12-11T10:00:00Z",
        "end_time": "2025-12-11T12:00:00Z"
      }
    ]
  }
}'
