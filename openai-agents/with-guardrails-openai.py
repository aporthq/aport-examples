"""
Complete Security Stack: GuardrailsOpenAI + APort

This example demonstrates how to use BOTH GuardrailsOpenAI and APort together
for complete agent security:

1. GuardrailsOpenAI: Data safety (input/output guardrails)
   - Wraps LLM client
   - Validates prompts and responses
   - Protects against injection attacks

2. APort: Action authorization (pre-action guardrails)
   - Wraps tool execution
   - Enforces business policies
   - Checks agent identity and limits

Together, they provide "defense in depth" for AI agents.

This pattern works with any agent framework because:
- GuardrailsOpenAI wraps the LLM client (framework-agnostic)
- APort wraps tool functions (framework-agnostic)
"""

import asyncio
import os
from pathlib import Path
from typing import Dict, Any

# Import GuardrailsOpenAI (recommended for production)
# GuardrailsOpenAI is a drop-in replacement for OpenAI with input/output guardrails
from guardrails import GuardrailsOpenAI, GuardrailTripwireTriggered

# Alternative: Use regular OpenAI (works too, but no input/output guardrails)
# from openai import OpenAI

# Note: OpenAI Agents SDK imports (adjust based on actual SDK)
# from openai.agents import Agent, Tool
# from agents import GuardrailAgent, Runner, RunConfig
# from agents.run import InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered

# Import APort SDK
from aporthq_sdk_python import APortClient, APortClientOptions
from pre_action_authorization import PreActionAuthorizer, with_pre_action_authorization, AuthorizationError

# Configuration
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "your-openai-api-key")
APORT_API_URL = os.environ.get("APORT_API_URL", "https://api.aport.io")
AGENT_ID = os.environ.get("APORT_AGENT_ID", "ap_demo_agent")

# 1. GuardrailsOpenAI: Data safety (input/output guardrails)
# Wraps the LLM client to validate prompts and responses
# This is a drop-in replacement for OpenAI - same API, but with guardrails
try:
    guardrails_client = GuardrailsOpenAI(
        api_key=OPENAI_API_KEY,
        config=Path("guardrails_config.json") if Path("guardrails_config.json").exists() else None,
    )
    print("✅ Using GuardrailsOpenAI (with input/output guardrails)")
except Exception as e:
    print(f"⚠️  GuardrailsOpenAI not available: {e}")
    print("   Install with: pip install openai-guardrails")
    print("   Configure at: https://guardrails.openai.com")
    # Fallback: Use regular OpenAI (works too, but no guardrails)
    # from openai import OpenAI
    # guardrails_client = OpenAI(api_key=OPENAI_API_KEY)
    guardrails_client = None

# 2. APort: Action authorization (pre-action guardrails)
# Wraps tool execution to enforce business policies
aport_client = APortClient(APortClientOptions(base_url=APORT_API_URL))
authorizer = PreActionAuthorizer(aport_client)


# Tool with APort authorization
@with_pre_action_authorization(
    authorizer=authorizer,
    agent_id=AGENT_ID,
    policy_id="finance.payment.refund.v1",
    build_context=lambda amount, currency, customer_id: {
        "amount": amount,
        "currency": currency,
        "customer_id": customer_id,
    }
)
async def execute_refund(amount: int, currency: str, customer_id: str) -> Dict[str, Any]:
    """
    Execute a refund with complete security:
    - GuardrailsOpenAI validated the user's prompt (input guardrails)
    - LLM decided to call this tool
    - APort authorized the action (pre-action authorization) ← We are here
    - Now we execute the refund
    - GuardrailsOpenAI will validate the response (output guardrails)
    """
    print(f"✅ Executing refund: ${amount/100:.2f} {currency} for {customer_id}")
    
    # Your actual refund logic
    await asyncio.sleep(0.1)  # Simulate API call
    
    return {
        "status": "success",
        "refund_id": f"ref_{customer_id}_{amount}",
        "amount": amount,
        "currency": currency,
    }


# Example: Agent with complete security stack
# Using GuardrailAgent (automatically uses GuardrailsOpenAI)
# Uncomment and adjust when OpenAI Agents SDK is available:
#
# from agents import GuardrailAgent, Runner, RunConfig
# from agents.run import InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered
#
# agent = GuardrailAgent(
#     config=Path("guardrails_config.json"),
#     name="Customer support agent",
#     instructions=(
#         "You are a customer support agent. Process refunds when requested. "
#         "Always confirm details before processing."
#     ),
#     tools=[
#         Tool(
#             name="refund",
#             description="Process a customer refund",
#             function=execute_refund,  # ← APort (action authorization)
#         )
#     ]
# )
#
# # Run with complete security:
# async def run_agent():
#     try:
#         result = await Runner.run(
#             agent,
#             "Refund $50 to customer_123",
#             run_config=RunConfig(tracing_disabled=True)
#         )
#         print(result.final_output)
#     except (InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered) as e:
#         print(f"🛑 GuardrailsOpenAI triggered: {e}")
#     except AuthorizationError as e:
#         print(f"🛑 APort authorization denied: {e.message}")


async def demonstrate_security_layers():
    """
    Demonstrates the complete security flow.
    """
    print("🛡️ Complete Security Stack: GuardrailsOpenAI + APort")
    print("=" * 60)
    print()
    print("Security Layers:")
    print("1. Input Guardrails (GuardrailsOpenAI)")
    print("   - Validates user prompt for safety")
    print("   - Blocks injection attacks")
    print("   - Sanitizes input")
    print()
    print("2. LLM Inference")
    print("   - Agent decides what action to take")
    print("   - 'I should refund $50 to customer_123'")
    print()
    print("3. Pre-Action Authorization (APort)")
    print("   - Checks agent identity (passport)")
    print("   - Enforces business policies")
    print("   - Validates limits and permissions")
    print()
    print("4. Tool Execution")
    print("   - Refund API call (if authorized)")
    print("   - Side effects happen here")
    print()
    print("5. Output Guardrails (GuardrailsOpenAI)")
    print("   - Validates response for safety")
    print("   - Removes sensitive data")
    print("   - Formats output")
    print()

    # Example flow
    print("Example Flow:")
    print("-" * 60)
    print("User: 'Refund $10,000 to customer_123'")
    print()
    print("→ GuardrailsOpenAI: ✅ Input validated (no injection detected)")
    print("→ LLM: Decides to call refund tool")
    print("→ APort: ❌ Authorization denied (amount exceeds limit)")
    print("→ Agent: Returns 'Refund denied: Amount exceeds policy limit'")
    print("→ GuardrailsOpenAI: ✅ Output validated (safe response)")
    print("→ User: 'Refund denied: Amount exceeds policy limit'")
    print()

    # Test the authorization
    print("Testing Authorization:")
    print("-" * 60)
    try:
        result = await execute_refund(5000, "USD", "cust_123")
        print(f"✅ Refund authorized and executed: {result}")
    except AuthorizationError as e:
        print(f"❌ Refund denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")

    print()
    print("=" * 60)
    print("✨ This is 'defense in depth' for AI agents!")
    print()
    print("Key Points:")
    print("- GuardrailsOpenAI and APort solve DIFFERENT problems")
    print("- GuardrailsOpenAI: Data safety (input/output)")
    print("- APort: Action authorization (pre-action)")
    print("- They're COMPLEMENTARY, not competitive")
    print("- Use both for complete security")


async def main():
    await demonstrate_security_layers()
    await aport_client.close()


if __name__ == "__main__":
    asyncio.run(main())

