#!/bin/bash

# Basic cURL examples for The Passport for AI Agents
# Make sure to set your API_URL and ADMIN_TOKEN environment variables

API_BASE_URL=${API_URL:-"https://api.aport.io"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"your-admin-token"}

echo "🚀 The Passport for AI Agents - cURL Examples"
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

make_request "GET" "/api/verify/ap_a2d10232c6534523812423eec8a1425c"
make_request "GET" "/api/verify/ap_a2d10232c6534523812423eec8a1425c"

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
    make_request "GET" "/api/verify/ap_a2d10232c6534523812423eec8a1425c"
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

make_request "GET" "/api/verify-compact?agent_id=ap_a2d10232c6534523812423eec8a1425c"

# 9. Test policy verification (NEW - Policy verification with automatic passport check)
echo -e "\n${YELLOW}9. Testing policy verification${NC}"
echo "====================================="

echo "Note: Policy verification automatically verifies the passport - no need to call /api/verify/{agent_id} first"

# Example 1: Refund policy verification
refund_policy='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "finance.payment.refund.v1",
    "context": {
      "amount": 5000,
      "currency": "USD",
      "customer_id": "cust_123",
      "reason": "Customer request"
    }
  }
}'

echo -e "\n${BLUE}Example 1: Refund policy verification${NC}"
make_request "POST" "/api/verify/policy/finance.payment.refund.v1" "$refund_policy"

# Example 2: Data export policy verification
export_policy='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "data.export.create.v1",
    "context": {
      "table_name": "users",
      "row_limit": 1000,
      "include_pii": false
    }
  }
}'

echo -e "\n${BLUE}Example 2: Data export policy verification${NC}"
make_request "POST" "/api/verify/policy/data.export.create.v1" "$export_policy"

# Example 3: Repository merge policy verification
merge_policy='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "code.repository.merge.v1",
    "context": {
      "repo": "company/my-repo",
      "base_branch": "main",
      "files_changed": 5,
      "lines_added": 100,
      "labels": ["approved", "tested"],
      "reviews": 2
    }
  }
}'

echo -e "\n${BLUE}Example 3: Repository merge policy verification${NC}"
make_request "POST" "/api/verify/policy/code.repository.merge.v1" "$merge_policy"

# Example 4: Refund with MCP context (single server/tool)
echo -e "\n${BLUE}Example 4: Refund policy with MCP context (single)${NC}"
refund_mcp_single='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "finance.payment.refund.v1",
    "context": {
      "amount": 5000,
      "currency": "USD",
      "customer_id": "cust_123",
      "order_id": "order_456",
      "reason_code": "customer_request",
      "region": "US",
      "idempotency_key": "refund_mcp_001",
      "mcp_server": "https://mcp.stripe.com",
      "mcp_tool": "stripe.refunds.create"
    }
  }
}'
make_request "POST" "/api/verify/policy/finance.payment.refund.v1" "$refund_mcp_single"

# Example 5: Refund with MCP context (multiple servers/tools - preferred)
echo -e "\n${BLUE}Example 5: Refund policy with MCP context (multiple)${NC}"
refund_mcp_multiple='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "finance.payment.refund.v1",
    "context": {
      "amount": 5000,
      "currency": "USD",
      "customer_id": "cust_123",
      "order_id": "order_456",
      "reason_code": "customer_request",
      "region": "US",
      "idempotency_key": "refund_mcp_002",
      "mcp_servers": ["https://mcp.stripe.com", "https://mcp.notion.com"],
      "mcp_tools": ["stripe.refunds.create", "notion.pages.export"],
      "mcp_session": "session_123"
    }
  }
}'
make_request "POST" "/api/verify/policy/finance.payment.refund.v1" "$refund_mcp_multiple"

# Example 6: Data export with MCP context (multiple servers/tools)
echo -e "\n${BLUE}Example 6: Data export policy with MCP context (multiple)${NC}"
export_mcp_multiple='{
  "context": {
    "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
    "policy_id": "data.export.create.v1",
    "context": {
      "table_name": "users",
      "row_limit": 1000,
      "include_pii": false,
      "mcp_servers": ["https://mcp.notion.com", "https://mcp.snowflake.com"],
      "mcp_tools": ["notion.pages.export", "snowflake.query.execute"],
      "mcp_session": "session_456"
    }
  }
}'
make_request "POST" "/api/verify/policy/data.export.create.v1" "$export_mcp_multiple"

# 10. Test webhook endpoint
echo -e "\n${YELLOW}10. Testing webhook endpoint${NC}"
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
