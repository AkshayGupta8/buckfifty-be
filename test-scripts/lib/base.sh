#!/usr/bin/env bash

# Shared helpers for test-scripts.
#
# Usage from any script:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/../lib/base.sh"
#   parse_base_url "$@"
#   # BASE_URL is now set
#
# Supported flags:
#   --prod                  Use the prod base URL
#   --base-url <url>        Override base URL explicitly
#   --help                  Print help

set -euo pipefail

DEFAULT_BASE_URL="http://localhost:3000"
PROD_BASE_URL="https://api.buckfifty-ai-herdmanager.click"

print_test_scripts_help() {
  cat <<'EOF'
Usage:
  <script>.sh [--prod] [--base-url <url>] [--] [script args...]

Options:
  --prod            Use prod base URL (http://new-be.buckfifty-ai-herdmanager.click)
  --base-url <url>  Override base URL explicitly
  --help            Show this help

Default:
  Base URL defaults to http://localhost:3000
EOF
}

# Returns 0 if we should default to prod based on invocation path.
# This allows running via symlink paths like ./test-scripts/prod/users/list_users.sh
# without passing --prod explicitly.
should_default_to_prod() {
  # Prefer the actual invoked command path ($0). If something exotic happens,
  # fall back to this file's path.
  local invoked="${0:-}"
  if [[ -z "$invoked" ]]; then
    invoked="${BASH_SOURCE[0]}"
  fi

  [[ "$invoked" == *"/prod/"* ]]
}

# Sets BASE_URL and also exposes remaining non-flag args in REMAINING_ARGS array.
parse_base_url() {
  if should_default_to_prod; then
    BASE_URL="$PROD_BASE_URL"
  else
    BASE_URL="$DEFAULT_BASE_URL"
  fi

  REMAINING_ARGS=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prod)
        BASE_URL="$PROD_BASE_URL"
        shift
        ;;
      --base-url)
        if [[ $# -lt 2 ]]; then
          echo "Error: --base-url requires a value" >&2
          exit 1
        fi
        BASE_URL="$2"
        shift 2
        ;;
      --help|-h)
        print_test_scripts_help
        exit 0
        ;;
      --)
        shift
        # everything after -- is positional
        while [[ $# -gt 0 ]]; do
          REMAINING_ARGS+=("$1")
          shift
        done
        ;;
      --*)
        echo "Error: Unknown flag: $1" >&2
        echo "Run with --help for usage." >&2
        exit 1
        ;;
      *)
        REMAINING_ARGS+=("$1")
        shift
        ;;
    esac
  done

  export BASE_URL
}
