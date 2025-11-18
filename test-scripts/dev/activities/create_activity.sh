#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

# Create a new activity
curl -X POST "$BASE_URL/activities" -H "Content-Type: application/json" -d '{
  "name": "Test Activity",
  "user_id": "c12fe5c3-b585-423f-a242-5813a4a6eb66"
}'
