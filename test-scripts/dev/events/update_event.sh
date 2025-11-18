#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <event_id>"
  exit 1
fi

EVENT_ID=$1

# Update event by ID
curl -X PUT "$BASE_URL/events/$EVENT_ID" -H "Content-Type: application/json" -d '{
  "name": "Updated Test Event",
  "description": "This is an updated test event",
  "start_time": "2025-12-01T11:00:00Z",
  "end_time": "2025-12-01T13:00:00Z"
}'
