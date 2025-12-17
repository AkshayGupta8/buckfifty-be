#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 3 ]]; then
  echo "Usage: $0 [--prod] <conversation_id> <message_id> <content>" >&2
  exit 1
fi

CONVERSATION_ID="${REMAINING_ARGS[0]}"
MESSAGE_ID="${REMAINING_ARGS[1]}"
CONTENT="${REMAINING_ARGS[2]}"

BODY=$(jq -nc --arg content "$CONTENT" '{content:$content}')

curl -sS -X PUT "$BASE_URL/conversations/$CONVERSATION_ID/messages/$MESSAGE_ID" \
  -H "Content-Type: application/json" \
  -d "$BODY" | jq
