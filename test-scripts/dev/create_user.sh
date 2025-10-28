#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

# Create a new user
curl -X POST "$BASE_URL/users" -H "Content-Type: application/json" -d '{
  "first_name": "Test",
  "last_name": "User",
  "email": "testuser@example.com",
  "phone_number": "+17204164661",
  "timezone": "America/New_York"
}'
