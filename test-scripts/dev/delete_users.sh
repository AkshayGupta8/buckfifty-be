#!/bin/bash

# Base URL of the API
BASE_URL="http://new-be.buckfifty-ai-herdmanager.click"


if [ -z "$1" ]; then
  echo "Usage: $0 <user_id>"
  exit 1
fi

USER_ID=$1

# Send authentication code to user's phone
curl -X DELETE "$BASE_URL/users/$USER_ID"
