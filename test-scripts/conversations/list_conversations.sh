#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/base.sh"
parse_base_url "$@"

INCLUDE="${REMAINING_ARGS[0]:-}"

URL="$BASE_URL/conversations"
if [[ "$INCLUDE" == "--include-messages" ]]; then
  URL="$URL?includeMessages=1"
fi

curl -sS "$URL" | jq
