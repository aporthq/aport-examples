#!/bin/bash

# Basic cURL examples for AI Agent Passport Registry
# Make sure to set your API_URL and ADMIN_TOKEN environment variables

API_BASE_URL=${API_URL:-"https://api.aport.io"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"your-admin-token"}

echo "🚀 AI Agent Passport Registry - cURL Examples"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to make API calls with error handling
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local auth_header=$4
    
    echo -e "\n${BLUE}Making $method request to $endpoint${NC}"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            ${auth_header:+-H "$auth_header"} \
            -d "$data" \
            "$API_BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            ${auth_header:+-H "$auth_header"} \
            "$API_BASE_URL$endpoint")
    fi
    
    # Split response and status code
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    
    if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ]; then
        echo -e "${GREEN}✅ Success ($status_code)${NC}"
        echo "$body" | jq . 2>/dev/null || echo "$body"
    else
        echo -e "${RED}❌ Error ($status_code)${NC}"
        echo "$body" | jq . 2>/dev/null || echo "$body"
    fi
    
    return $status_code
}

# 1. Verify existing passports
echo -e "\n${YELLOW}1. Verifying existing passports${NC}"
echo "================================"

make_request "GET" "/api/verify/ap_demo_001"
make_request "GET" "/api/verify/aeebc92d-13fb-4e23-8c3c-1aa82b167da6"

# 2. Create a new passport
echo -e "\n${YELLOW}2. Creating a new passport${NC}"
echo "============================="

new_passport='{
  "agent_id": "ap_curl_example",
  "owner": "cURL Example",
  "role": "Tier-1",
  "permissions": ["read:data", "create:reports"],
  "limits": {
    "api_calls_per_hour": 500,
    "ticket_creation_daily": 25
  },
  "regions": ["US-CA"],
  "status": "active",
  "contact": "example@curl.com",
  "version": "1.0.0"
}'

make_request "POST" "/api/admin/create" "$new_passport" "Authorization: Bearer $ADMIN_TOKEN"

# 3. List all agents
echo -e "\n${YELLOW}3. Listing all agents${NC}"
echo "======================"

make_request "GET" "/api/admin/agents" "" "Authorization: Bearer $ADMIN_TOKEN"

# 4. Update agent status
echo -e "\n${YELLOW}4. Updating agent status${NC}"
echo "========================="

status_update='{
  "agent_id": "ap_curl_example",
  "status": "suspended",
  "reason": "Testing suspension"
}'

make_request "POST" "/api/admin/status" "$status_update" "Authorization: Bearer $ADMIN_TOKEN"

# 5. Get system metrics
echo -e "\n${YELLOW}5. Getting system metrics${NC}"
echo "============================"

make_request "GET" "/api/metrics" "" "Authorization: Bearer $ADMIN_TOKEN"

# 6. Test rate limiting
echo -e "\n${YELLOW}6. Testing rate limiting${NC}"
echo "========================="

echo "Making multiple rapid requests to test rate limiting..."
for i in {1..5}; do
    echo -n "Request $i: "
    make_request "GET" "/api/verify/ap_demo_001"
    sleep 0.5
done

# 7. Test error handling
echo -e "\n${YELLOW}7. Testing error handling${NC}"
echo "============================"

echo "Testing with invalid agent ID:"
make_request "GET" "/api/verify/invalid_id"

echo "Testing without required parameter:"
make_request "GET" "/api/verify"

echo "Testing admin endpoint without auth:"
make_request "GET" "/api/admin/agents"

# 8. Test compact verification
echo -e "\n${YELLOW}8. Testing compact verification${NC}"
echo "=================================="

make_request "GET" "/api/verify-compact?agent_id=ap_demo_001"

# 9. Test webhook endpoint
echo -e "\n${YELLOW}9. Testing webhook endpoint${NC}"
echo "============================="

webhook_test='{
  "webhook_url": "https://webhook.site/your-unique-url",
  "event": "passport.updated"
}'

make_request "POST" "/api/admin/webhook-test" "$webhook_test" "Authorization: Bearer $ADMIN_TOKEN"

echo -e "\n${GREEN}✨ All examples completed!${NC}"
echo ""
echo "💡 Tips:"
echo "- Set API_URL environment variable to test against different environments"
echo "- Set ADMIN_TOKEN environment variable with your admin token"
echo "- Install jq for better JSON formatting: brew install jq (macOS) or apt-get install jq (Ubuntu)"
echo "- Check rate limit headers in responses for monitoring usage"
