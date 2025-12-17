#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <user_id> [state_json]" >&2
  echo "Example: $0 00000000-0000-0000-0000-000000000000 '{\"summary\":\"hi\"}'" >&2
  exit 1
fi

USER_ID="${REMAINING_ARGS[0]}"
STATE_JSON="${REMAINING_ARGS[1]:-}"

if [[ -n "$STATE_JSON" ]]; then
  BODY=$(jq -nc --arg user_id "$USER_ID" --argjson state "$STATE_JSON" '{user_id:$user_id, state:$state}')
else
  BODY=$(jq -nc --arg user_id "$USER_ID" '{user_id:$user_id}')
fi

curl -sS -X POST "$BASE_URL/conversations" \
  -H "Content-Type: application/json" \
  -d "$BODY" | jq
