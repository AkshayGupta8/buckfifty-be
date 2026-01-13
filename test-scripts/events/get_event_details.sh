#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <event_id>" >&2
  exit 1
fi

EVENT_ID="${REMAINING_ARGS[0]}"

curl -sS \
  -X GET \
  "$BASE_URL/events/$EVENT_ID/details" \
  -H "Content-Type: application/json" \
  | jq
