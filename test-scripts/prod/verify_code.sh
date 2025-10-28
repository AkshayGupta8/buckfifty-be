#!/bin/bash

# Base URL of the API
BASE_URL="https://c59da4db672d.ngrok-free.app"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <user_id> <code>"
  exit 1
fi

USER_ID=$1
CODE=$2

# Verify authentication code
curl -X POST "$BASE_URL/users/$USER_ID/verify-code" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\"}"
