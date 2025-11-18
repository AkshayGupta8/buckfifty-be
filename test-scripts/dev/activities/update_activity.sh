#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <activity_id>"
  exit 1
fi

ACTIVITY_ID=$1

# Update activity by ID
curl -X PUT "$BASE_URL/activities/$ACTIVITY_ID" -H "Content-Type: application/json" -d '{
  "name": "Updated Test Activity",
  "description": "This is an updated test activity"
}'
