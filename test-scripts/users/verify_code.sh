#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -ne 2 ]]; then
  echo "Usage: $0 [--prod] <user_id> <code>" >&2
  exit 1
fi

USER_ID="${REMAINING_ARGS[0]}"
CODE="${REMAINING_ARGS[1]}"

curl -X POST "$BASE_URL/users/$USER_ID/verify-code" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}"
