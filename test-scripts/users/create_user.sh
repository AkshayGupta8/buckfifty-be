#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

# Create a new user (note the formatting of the phone number)
curl -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d '{
  "first_name": "Akshay",
  "last_name": "Gupta",
  "email": "testuser@example.com",
  "phone_number": "+17204164661",
  "timezone": "America/New_York"
}'
