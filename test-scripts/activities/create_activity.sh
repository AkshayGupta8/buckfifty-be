#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

# Create a new activity
curl -X POST "$BASE_URL/activities" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Test Activity",
  "user_id": "c12fe5c3-b585-423f-a242-5813a4a6eb66"
}'
