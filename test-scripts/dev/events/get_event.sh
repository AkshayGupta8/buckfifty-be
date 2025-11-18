#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <event_id>"
  exit 1
fi

EVENT_ID=$1

# Get event by ID
curl "$BASE_URL/events/$EVENT_ID"
