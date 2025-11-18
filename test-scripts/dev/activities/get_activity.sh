#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <activity_id>"
  exit 1
fi

ACTIVITY_ID=$1

# Get activity by ID
curl "$BASE_URL/activities/$ACTIVITY_ID"
