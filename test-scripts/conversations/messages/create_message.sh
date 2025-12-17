#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 4 ]]; then
  echo "Usage: $0 [--prod] <conversation_id> <role:user|assistant> <direction:inbound|outbound> <content>" >&2
  exit 1
fi

CONVERSATION_ID="${REMAINING_ARGS[0]}"
ROLE="${REMAINING_ARGS[1]}"
DIRECTION="${REMAINING_ARGS[2]}"
CONTENT="${REMAINING_ARGS[3]}"

BODY=$(jq -nc --arg role "$ROLE" --arg direction "$DIRECTION" --arg content "$CONTENT" '{role:$role, direction:$direction, content:$content}')

curl -sS -X POST "$BASE_URL/conversations/$CONVERSATION_ID/messages" \
  -H "Content-Type: application/json" \
  -d "$BODY" | jq
