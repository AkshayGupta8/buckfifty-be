#!/bin/bash

# Base URL of the API
BASE_URL="http://localhost:3000"

# File containing list of user IDs to delete
USER_IDS_FILE="temp"

if [ ! -f "$USER_IDS_FILE" ]; then
  echo "User IDs file '$USER_IDS_FILE' not found!"
  exit 1
fi

while IFS= read -r USER_ID
do
  if [ -n "$USER_ID" ]; then
    echo "Deleting user with ID: $USER_ID"
    curl -X DELETE "$BASE_URL/users/$USER_ID"
    echo -e "\n"
  fi
done < "$USER_IDS_FILE"
