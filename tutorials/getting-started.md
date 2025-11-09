# Getting Started Tutorial

This tutorial will walk you through your first interactions with The Passport for AI Agents API.

## Prerequisites

- Basic understanding of HTTP and JSON
- Command-line access (curl, wget, or similar)
- Optional: Programming language of choice (JavaScript, Python, etc.)

## Step 1: Understanding the API

The Passport for AI Agents provides a RESTful API for managing AI agent identities. The main concepts are:

- **Agent Passport**: A digital identity document for an AI agent
- **Verification**: Checking if an agent passport is valid and active
- **Admin Operations**: Creating and managing agent passports (requires authentication)

## Step 2: Your First API Call

Let's start by verifying an existing agent passport:

```bash
curl "https://api.aport.io/api/verify/ap_a2d10232c6534523812423eec8a1425c"
```

**Expected Response:**
```json
{
  "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
  "owner": "AI Passport Registry Demo",
  "role": "Tier-1",
  "permissions": ["read:tickets", "create:tickets", "update:tickets"],
  "limits": {
    "ticket_creation_daily": 50,
    "api_calls_per_hour": 1000
  },
  "regions": ["US-CA", "US-NY", "EU-DE"],
  "status": "active",
  "contact": "demo@aport.io",
  "updated_at": "2025-09-10T10:07:25.554Z",
  "version": "1.0.0"
}
```

## Step 3: Understanding the Response

The response contains:
- **agent_id**: Unique identifier for the agent
- **owner**: Organization or individual who owns the agent
- **role**: Agent's tier level or role
- **permissions**: What the agent is allowed to do
- **limits**: Operational constraints
- **regions**: Geographic areas where the agent can operate
- **status**: Current state (active, suspended, revoked)
- **contact**: Email for the agent
- **version**: Schema version
- **updated_at**: Last modification timestamp

## Step 4: Testing Different Agents

Try verifying different agent IDs:

```bash
# Another demo agent
curl "https://api.aport.io/api/verify/ap_a2d10232c6534523812423eec8a1425c"

# Non-existent agent (will return 404)
curl "https://api.aport.io/api/verify/ap_nonexistent"
```

## Step 5: Understanding Error Responses

When an agent doesn't exist, you'll get a 404 error:

```json
{
  "error": "not_found",
  "message": "Agent passport not found",
  "details": {
    "agent_id": "ap_nonexistent"
  }
}
```

## Step 6: Using Compact Verification

For applications that only need basic status information:

```bash
curl "https://api.aport.io/api/verify-compact?agent_id=ap_a2d10232c6534523812423eec8a1425c"
```

**Response:**
```json
{
  "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
  "status": "active",
  "role": "Tier-1"
}
```

## Step 7: Rate Limiting

Notice the response headers include rate limiting information:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1640995200
X-RateLimit-Window: 60
```

- **Limit**: Maximum requests per minute
- **Remaining**: Requests left in current window
- **Reset**: When the window resets (Unix timestamp)
- **Window**: Window size in seconds

## Step 8: Admin Operations (Optional)

If you have admin access, you can create and manage passports:

```bash
# Create a new passport
curl -X POST "https://api.aport.io/api/admin/create" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "ap_my_agent",
    "owner": "My Company",
    "role": "Tier-1",
    "permissions": ["read:data"],
    "limits": {
      "api_calls_per_hour": 1000
    },
    "regions": ["US-CA"],
    "status": "active",
    "contact": "admin@mycompany.com",
    "version": "1.0.0"
  }'
```

## Step 9: Policy Verification

Policy verification allows you to check if an agent is authorized to perform specific actions. **Important:** Policy verification automatically verifies the passport, so you don't need to call `/api/verify/{agent_id}` first.

### Basic Policy Verification

```bash
curl -X POST "https://api.aport.io/api/verify/policy/finance.payment.refund.v1" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "agent_id": "ap_a2d10232c6534523812423eec8a1425c",
      "policy_id": "finance.payment.refund.v1",
      "context": {
        "amount": 5000,
        "currency": "USD",
        "customer_id": "cust_123"
      }
    }
  }'
```

**Response:**
```json
{
  "decision": {
    "decision_id": "dec_123456789",
    "allow": true,
    "reasons": [
      {
        "code": "capability_verified",
        "message": "Agent has required refund capability",
        "severity": "info"
      }
    ],
    "assurance_level": "L2",
    "created_at": "2025-01-16T10:30:00Z",
    "expires_in": 300
  },
  "request_id": "policy_123456789_abc123"
}
```

### Request Structure

- **Endpoint**: `/api/verify/policy/{pack_id}` (POST)
- **pack_id**: Policy pack identifier (e.g., `finance.payment.refund.v1`)
- **Request Body**:
  ```json
  {
    "context": {
      "agent_id": "ap_...",        // Required: Agent passport ID
      "policy_id": "...",           // Required: Policy ID (usually same as pack_id)
      "context": { ... },           // Required: Policy-specific context
      "idempotency_key": "..."     // Optional: For duplicate request prevention
    }
  }
  ```

### Response Structure

- **decision.allow**: `true` if authorized, `false` if denied
- **decision.decision_id**: Unique identifier for audit trails
- **decision.reasons**: Array of reason codes and messages
- **decision.assurance_level**: Required assurance level
- **decision.expires_in**: Decision TTL in seconds

### Common Policy Packs

- `finance.payment.refund.v1` - Payment refunds
- `finance.payment.charge.v1` - Payment charges
- `data.export.create.v1` - Data exports
- `code.repository.merge.v1` - Repository merges
- `code.release.publish.v1` - Code releases
- `messaging.message.send.v1` - Messaging operations

## Step 10: Next Steps

Now that you understand the basics:

1. **Explore the full API**: Check out the [OpenAPI specification](../spec/openapi.yaml)
2. **Build a client**: Use the [language examples](../javascript/) to build your own client
3. **Handle errors**: Learn about [error handling patterns](../error-handling/)
4. **Implement rate limiting**: See [rate limiting best practices](../rate-limiting/)
5. **Set up webhooks**: Learn about [webhook integration](../webhooks/)
6. **Use policy verification**: See [policy verification examples](../curl/) for more examples

## Common Use Cases

### 1. Agent Authentication
Before allowing an agent to perform actions, verify its passport:

```bash
# Check if agent is active
curl "https://api.aport.io/api/verify/ap_my_agent"
```

### 2. Permission Checking
Verify what an agent is allowed to do:

```javascript
const response = await fetch('https://api.aport.io/api/verify?/ap_my_agent');
const passport = await response.json();

if (passport.permissions.includes('create:tickets')) {
  // Allow ticket creation
}
```

### 3. Regional Restrictions
Check if an agent can operate in a specific region:

```python
import requests

response = requests.get('https://api.aport.io/api/verify?/ap_my_agent')
passport = response.json()

if 'US-CA' in passport['regions']:
    # Allow operation in California
```

## Troubleshooting

### Common Issues

1. **404 Not Found**: Agent ID doesn't exist
2. **429 Too Many Requests**: Rate limit exceeded
3. **401 Unauthorized**: Missing or invalid admin token
4. **400 Bad Request**: Invalid request format

### Getting Help

- **Documentation**: Check the [full documentation](../../docs/)
- **Examples**: Browse the [examples directory](../)
- **Issues**: Report problems on [GitHub](github.com/aporthq/agent-passport/issues)
- **Discussions**: Ask questions in [GitHub Discussions](github.com/aporthq/agent-passport/discussions)

## What's Next?

You're now ready to:
- Build applications that use agent passports
- Implement agent authentication systems
- Create monitoring and management tools
- Contribute to the project

Happy coding! 🚀
