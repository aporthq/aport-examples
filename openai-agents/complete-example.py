"""
Complete OpenAI Agents SDK + GuardrailsOpenAI + APort Integration Example

This example shows a working agent with complete security:
1. GuardrailsOpenAI: Data safety (input/output guardrails)
2. OpenAI Agents SDK: Agent runtime
3. APort: Pre-action authorization (action guardrails)
4. Error handling and audit trails

This demonstrates the framework-agnostic pattern: APort wraps tool execution,
not the LLM client. This works with any agent framework (OpenAI, Anthropic,
LangChain, Microsoft Agent Framework, etc.).

Prerequisites:
    pip install openai-guardrails
    pip install aporthq-sdk-python

Run: python complete-example.py
"""

import asyncio
import os
from pathlib import Path
from typing import Dict, Any

# Option 1: Use GuardrailsOpenAI (recommended for production)
# GuardrailsOpenAI is a drop-in replacement for OpenAI with input/output guardrails
from guardrails import GuardrailsOpenAI, GuardrailTripwireTriggered

# Option 2: Use regular OpenAI (works too, but no input/output guardrails)
# from openai import OpenAI

# Note: OpenAI Agents SDK imports (adjust based on actual SDK)
# from openai.agents import Agent, Tool
# from agents import Runner, RunConfig

# Import APort SDK
from aporthq_sdk_python import APortClient, APortClientOptions, PolicyVerificationResponse

# Import the authorization pattern from pre_action_authorization.py
from pre_action_authorization import PreActionAuthorizer, with_pre_action_authorization, AuthorizationError

# Configuration
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "your-openai-api-key")
APORT_API_URL = os.environ.get("APORT_API_URL", "https://api.aport.io")
APORT_API_KEY = os.environ.get("APORT_API_KEY")  # Optional for public endpoints
AGENT_ID = os.environ.get("APORT_AGENT_ID", "ap_demo_agent")
GUARDRAILS_CONFIG = os.environ.get("GUARDRAILS_CONFIG", "guardrails_config.json")

# Initialize clients
# Option 1: GuardrailsOpenAI (with input/output guardrails)
# This wraps the OpenAI client and adds data safety checks
try:
    guardrails_client = GuardrailsOpenAI(
        api_key=OPENAI_API_KEY,
        config=Path(GUARDRAILS_CONFIG) if Path(GUARDRAILS_CONFIG).exists() else None,
    )
    print("✅ Using GuardrailsOpenAI (with input/output guardrails)")
except Exception as e:
    print(f"⚠️  GuardrailsOpenAI not available: {e}")
    print("   Falling back to regular OpenAI client")
    # Option 2: Regular OpenAI (works too, but no guardrails)
    # guardrails_client = OpenAI(api_key=OPENAI_API_KEY)
    guardrails_client = None

# APort client for action authorization
aport_client = APortClient(APortClientOptions(
    base_url=APORT_API_URL,
    api_key=APORT_API_KEY,
))
authorizer = PreActionAuthorizer(aport_client)


# Define tool with authorization
@with_pre_action_authorization(
    authorizer=authorizer,
    agent_id=AGENT_ID,
    policy_id="finance.payment.refund.v1",
    build_context=lambda amount, currency, customer_id, **kwargs: {
        "amount": amount,
        "currency": currency,
        "customer_id": customer_id,
        **kwargs
    }
)
async def execute_refund(amount: int, currency: str, customer_id: str, reason: str = "Customer request") -> Dict[str, Any]:
    """
    Execute a refund (with authorization).

    This function will only execute if APort authorization passes.
    The authorization check happens automatically before this function runs.
    """
    print(f"✅ Authorization passed! Executing refund...")
    print(f"   Amount: {amount/100:.2f} {currency}")
    print(f"   Customer: {customer_id}")
    print(f"   Reason: {reason}")

    # Your actual refund logic here
    # For demo, we'll simulate it
    await asyncio.sleep(0.1)  # Simulate API call
    refund_id = f"ref_{amount}_{customer_id}"

    return {
        "status": "success",
        "refund_id": refund_id,
        "amount": amount,
        "currency": currency,
        "customer_id": customer_id,
    }


# Example: Create agent with complete security stack
# This shows how to combine GuardrailsOpenAI + APort for complete security
#
# Uncomment and adjust when OpenAI Agents SDK is available:
#
# from agents import GuardrailAgent, Runner, RunConfig
# from agents.run import InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered
#
# # Option 1: Use GuardrailAgent (automatically uses GuardrailsOpenAI)
# agent = GuardrailAgent(
#     config=Path(GUARDRAILS_CONFIG),
#     name="Customer support agent",
#     instructions=(
#         "You are a customer support agent that can process refunds. "
#         "When a customer requests a refund, use the refund tool to process it. "
#         "Always confirm the amount and currency before processing."
#     ),
#     tools=[
#         Tool(
#             name="refund",
#             description="Process a refund for a customer. Amount must be in cents (e.g., 5000 = $50.00).",
#             function=execute_refund,  # ← APort authorization happens here
#             parameters={
#                 "type": "object",
#                 "properties": {
#                     "amount": {"type": "integer", "description": "Amount in cents"},
#                     "currency": {"type": "string", "description": "Currency code (USD, EUR, etc.)"},
#                     "customer_id": {"type": "string", "description": "Customer ID"},
#                     "reason": {"type": "string", "description": "Reason for refund"},
#                 },
#                 "required": ["amount", "currency", "customer_id"],
#             }
#         )
#     ]
# )
#
# # Run agent with complete security:
# # 1. GuardrailsOpenAI validates input (input guardrails)
# # 2. LLM decides action
# # 3. APort authorizes action (pre-action authorization)
# # 4. Tool executes (if authorized)
# # 5. GuardrailsOpenAI validates output (output guardrails)
#
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


async def main():
    """
    Example usage demonstrating the complete security stack.
    """
    print("🤖 Complete Security Stack: GuardrailsOpenAI + APort")
    print("=" * 60)
    print()
    print("This example demonstrates:")
    print("1. GuardrailsOpenAI: Data safety (input/output guardrails)")
    print("2. APort: Action authorization (pre-action guardrails)")
    print("3. Framework-agnostic pattern (works with any agent framework)")
    print("4. Fail-closed by default with audit trails")
    print()
    print("Security Flow:")
    print("  User Input")
    print("    ↓")
    print("  GuardrailsOpenAI (input validation)")
    print("    ↓")
    print("  LLM Inference (agent decides action)")
    print("    ↓")
    print("  APort (action authorization) ← We test this here")
    print("    ↓")
    print("  Tool Execution (if authorized)")
    print("    ↓")
    print("  GuardrailsOpenAI (output validation)")
    print()

    # Example 1: Authorized refund (within limits)
    print("📝 Test 1: Refund within limits ($50)")
    print("-" * 60)
    try:
        result = await execute_refund(
            amount=5000,  # $50.00 in cents
            currency="USD",
            customer_id="cust_123",
            reason="Customer requested refund"
        )
        print(f"✅ Refund successful: {result}")
    except AuthorizationError as e:
        print(f"❌ Authorization denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")
        print(f"   Reasons: {e.decision.reasons}")
    except Exception as e:
        print(f"❌ Error: {e}")

    print()

    # Example 2: Large refund (might exceed limits)
    print("📝 Test 2: Large refund ($10,000)")
    print("-" * 60)
    try:
        result = await execute_refund(
            amount=1000000,  # $10,000.00 in cents
            currency="USD",
            customer_id="cust_456",
            reason="Large refund request"
        )
        print(f"✅ Refund successful: {result}")
    except AuthorizationError as e:
        print(f"❌ Authorization denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")
        print(f"   Reasons: {e.decision.reasons}")
        print("   (This is expected if the amount exceeds policy limits)")
    except Exception as e:
        print(f"❌ Error: {e}")

    print()

    # Example 3: Direct authorization check (without wrapper)
    print("📝 Test 3: Direct authorization check")
    print("-" * 60)
    try:
        decision = await authorizer.verify(
            agent_id=AGENT_ID,
            policy_id="finance.payment.refund.v1",
            context={
                "amount": 2500,  # $25.00 in cents
                "currency": "USD",
                "customer_id": "cust_789",
            }
        )
        print(f"✅ Authorization allowed: decision_id={decision.decision_id}")
        print(f"   Assurance level: {decision.assurance_level}")

        # Now safe to execute the tool
        result = await execute_refund(2500, "USD", "cust_789")
        print(f"✅ Refund executed: {result}")
    except AuthorizationError as e:
        print(f"❌ Authorization denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")

    print()
    print("=" * 60)
    print("✨ Example completed!")
    print()
    print("Key Takeaways:")
    print("- GuardrailsOpenAI wraps LLM client (data safety)")
    print("- APort wraps tool execution (action authorization)")
    print("- Both work together for complete security")
    print("- Works with any agent framework (OpenAI, Anthropic, LangChain, etc.)")
    print("- Fail-closed by default with immutable audit trails")
    print()
    print("Next Steps:")
    print("1. Install: pip install openai-guardrails")
    print("2. Configure guardrails at: https://guardrails.openai.com")
    print("3. Integrate with your OpenAI Agents SDK agent")
    print("4. See with-guardrails-openai.py for complete example")
    print("5. See README.md for more patterns")

    # Cleanup
    await aport_client.close()


if __name__ == "__main__":
    asyncio.run(main())

