#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <user_id> [--include-messages]" >&2
  exit 1
fi

USER_ID="${REMAINING_ARGS[0]}"
INCLUDE="${REMAINING_ARGS[1]:-}"

URL="$BASE_URL/conversations/by-user/$USER_ID"
if [[ "$INCLUDE" == "--include-messages" ]]; then
  URL="$URL?includeMessages=1"
fi

curl -sS "$URL" | jq
