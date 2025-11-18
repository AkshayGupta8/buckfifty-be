#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

if [ -z "$1" ]; then
  echo "Usage: $0 <user_id>"
  exit 1
fi

USER_ID=$1

# List events by user ID
curl "$BASE_URL/events/by-user/$USER_ID"
