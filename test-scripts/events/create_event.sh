#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

# Create a new event
curl -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d '{
  "created_by_user_id": "6a6880fa-a015-4bdd-9ba3-9aa334ec07c1",
  "activity_id": "0cccddea-83a6-484f-bf0d-97373d6ab568",
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
