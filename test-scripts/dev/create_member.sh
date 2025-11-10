#!/bin/bash

# Base URL of the API
BASE_URL="http://new-be.buckfifty-ai-herdmanager.click"

# Create a new member
curl -X POST "$BASE_URL/members" -H "Content-Type: application/json" -d '{
  "user_id": "c12fe5c3-b585-423f-a242-5813a4a6eb66",
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "+1234567890",
  "location": "New York"
}'
