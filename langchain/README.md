# Pre-Action Authorization for LangChain

This directory contains examples demonstrating **pre-action authorization** with LangChain and LangGraph using APort.

**Key Point:** APort wraps **tool execution**, not the LLM client. This makes it work with LangChain's agent executors, tools, and LangGraph workflows.

## What is Pre-Action Authorization?

Pre-action authorization fills a critical gap in the agent security stack:

1. **Input Guardrails**: Protect against malicious/unsafe **data** going into the LLM
2. **Pre-Action Authorization**: Enforce business policies and identity on **actions** ← **This pattern**
3. **Output Guardrails**: Protect against malicious/unsafe **data** coming out of the LLM

## Integration Pattern

LangChain supports multiple integration patterns:

### Pattern 1: Tool Decorator (Recommended)

Wrap your LangChain tools with the `@with_pre_action_authorization` decorator:

```python
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool
from pre_action_authorization import with_pre_action_authorization, PreActionAuthorizer

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
@tool
async def execute_refund(amount: int, currency: str, customer_id: str) -> str:
    """Process a refund for a customer."""
    # Your refund logic
    return f"Refund of ${amount/100:.2f} {currency} processed for {customer_id}"

# Use in LangChain agent
agent = create_openai_tools_agent(llm, tools=[execute_refund])
agent_executor = AgentExecutor(agent=agent, tools=[execute_refund])
```

### Pattern 2: LangGraph Tool Node

For LangGraph workflows, wrap tools in tool nodes:

```python
from langgraph.prebuilt import ToolNode
from pre_action_authorization import with_pre_action_authorization

# Wrap tools with authorization
authorized_tools = [
    with_pre_action_authorization(...)(execute_refund),
    with_pre_action_authorization(...)(export_data),
]

# Create tool node
tool_node = ToolNode(authorized_tools)
```

## Examples

Coming soon:
- `langchain-agent-example.py` - LangChain agent with pre-action authorization
- `langgraph-workflow-example.py` - LangGraph workflow with authorized tools
- `complete-langchain-example.py` - End-to-end LangChain integration

## Resources

- **LangChain Documentation**: [https://python.langchain.com](https://python.langchain.com)
- **LangGraph Documentation**: [https://langchain-ai.github.io/langgraph](https://langchain-ai.github.io/langgraph)
- **APort Documentation**: [https://docs.aport.io](https://docs.aport.io)
- **Open Agent Passport (OAP) Spec**: [https://github.com/aporthq/aport-spec](https://github.com/aporthq/aport-spec)

## Support

- **GitHub Issues**: [Report issues](https://github.com/aporthq/agent-passport/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/aporthq/agent-passport/discussions)

**Note**: The core pattern from `../openai-agents/pre_action_authorization.py` works with LangChain. This directory will contain LangChain-specific examples and patterns.

