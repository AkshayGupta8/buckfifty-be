#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <conversation_id> [take] [skip]" >&2
  exit 1
fi

CONVERSATION_ID="${REMAINING_ARGS[0]}"
TAKE="${REMAINING_ARGS[1]:-}"
SKIP="${REMAINING_ARGS[2]:-}"

URL="$BASE_URL/conversations/$CONVERSATION_ID/messages"
QS=()
if [[ -n "$TAKE" ]]; then QS+=("take=$TAKE"); fi
if [[ -n "$SKIP" ]]; then QS+=("skip=$SKIP"); fi

if [[ ${#QS[@]} -gt 0 ]]; then
  URL="$URL?$(IFS='&'; echo "${QS[*]}")"
fi

curl -sS "$URL" | jq
