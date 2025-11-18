#!/bin/bash

# Base URL of the API
BASE_URL="http://new-be.buckfifty-ai-herdmanager.click"

if [ -z "$1" ]; then
  echo "Usage: $0 <member_id>"
  exit 1
fi

MEMBER_ID=$1

# Delete member by ID
curl -X DELETE "$BASE_URL/members/$MEMBER_ID"
