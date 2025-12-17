#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 2 ]]; then
  echo "Usage: $0 [--prod] <conversation_id> <state_json>" >&2
  echo "Example: $0 00000000-0000-0000-0000-000000000000 '{\"summary\":\"new\"}'" >&2
  exit 1
fi

CONVERSATION_ID="${REMAINING_ARGS[0]}"
STATE_JSON="${REMAINING_ARGS[1]}"

BODY=$(jq -nc --argjson state "$STATE_JSON" '{state:$state}')

curl -sS -X PUT "$BASE_URL/conversations/$CONVERSATION_ID" \
  -H "Content-Type: application/json" \
  -d "$BODY" | jq
