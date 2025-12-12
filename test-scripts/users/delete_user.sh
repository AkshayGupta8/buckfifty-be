#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

if [[ ${#REMAINING_ARGS[@]} -lt 1 ]]; then
  echo "Usage: $0 [--prod] <user_id>" >&2
  exit 1
fi

USER_ID="${REMAINING_ARGS[0]}"

curl -X DELETE "$BASE_URL/users/$USER_ID"
