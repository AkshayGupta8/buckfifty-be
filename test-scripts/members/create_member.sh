#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

# Create a new member
curl -X POST "$BASE_URL/members" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Test Member",
  "user_id": "c12fe5c3-b585-423f-a242-5813a4a6eb66"
}'
