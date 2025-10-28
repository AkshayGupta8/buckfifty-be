#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <user_id>"
  exit 1
fi

USER_ID=$1

# Send authentication code to user's phone
curl -X POST "$BASE_URL/users/$USER_ID/send-code"
