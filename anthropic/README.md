# Pre-Action Authorization for Anthropic Claude

This directory contains examples demonstrating **pre-action authorization** with Anthropic Claude using APort.

**Key Point:** APort wraps **tool execution**, not the LLM client. This makes it work with Anthropic's tool use and agent frameworks.

## What is Pre-Action Authorization?

Pre-action authorization fills a critical gap in the agent security stack:

1. **Input Guardrails**: Protect against malicious/unsafe **data** going into the LLM
2. **Pre-Action Authorization**: Enforce business policies and identity on **actions** ← **This pattern**
3. **Output Guardrails**: Protect against malicious/unsafe **data** coming out of the LLM

## Integration Pattern

Anthropic Claude supports tool use through function calling. Wrap your tool functions with APort authorization:

```python
from anthropic import Anthropic
from pre_action_authorization import with_pre_action_authorization, PreActionAuthorizer

# Initialize Anthropic client
client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Define tool with authorization
@with_pre_action_authorization(
    authorizer=authorizer,
    agent_id="ap_my_agent",
    policy_id="finance.payment.refund.v1",
    build_context=lambda amount, currency, customer_id: {
        "amount": amount,
        "currency": currency,
        "customer_id": customer_id,
    }
)
async def execute_refund(amount: int, currency: str, customer_id: str) -> dict:
    """Process a refund for a customer."""
    # Your refund logic
    return {
        "status": "success",
        "refund_id": f"ref_{customer_id}",
        "amount": amount,
        "currency": currency,
    }

# Use in Claude tool use
response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    tools=[{
        "name": "execute_refund",
        "description": "Process a refund",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {"type": "integer"},
                "currency": {"type": "string"},
                "customer_id": {"type": "string"},
            },
            "required": ["amount", "currency", "customer_id"],
        },
    }],
    messages=[{"role": "user", "content": "Refund $50 to customer_123"}],
)

# Execute authorized tool when Claude requests it
if response.stop_reason == "tool_use":
    tool_use = response.content[0]
    if tool_use.name == "execute_refund":
        result = await execute_refund(**tool_use.input)  # ← APort authorization happens here
```

## Examples

Coming soon:
- `claude-tool-use-example.py` - Claude tool use with pre-action authorization
- `anthropic-agent-example.py` - Anthropic agent framework integration
- `complete-anthropic-example.py` - End-to-end Anthropic integration

## Resources

- **Anthropic Documentation**: [https://docs.anthropic.com](https://docs.anthropic.com)
- **Claude API Reference**: [https://docs.anthropic.com/claude/reference](https://docs.anthropic.com/claude/reference)
- **APort Documentation**: [https://docs.aport.io](https://docs.aport.io)
- **Open Agent Passport (OAP) Spec**: [https://github.com/aporthq/aport-spec](https://github.com/aporthq/aport-spec)

## Support

- **GitHub Issues**: [Report issues](https://github.com/aporthq/agent-passport/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/aporthq/agent-passport/discussions)

**Note**: The core pattern from `../openai-agents/pre_action_authorization.py` works with Anthropic. This directory will contain Anthropic-specific examples and patterns.

