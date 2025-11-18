#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

# Create a new event
curl -X POST "$BASE_URL/events" -H "Content-Type: application/json" -d '{
  "created_by_user_id": "c12fe5c3-b585-423f-a242-5813a4a6eb66",
  "activity_id": "27cfbfb1-0a17-4f4a-939e-a6537f7bc16a",
  "location": "Boulder",
  "max_participants": 10,
  "timeSlots": {
    "create": [
      {
        "start_time": "2025-12-01T10:00:00Z",
        "end_time": "2025-12-01T12:00:00Z"
      }
    ]
  }
}'
