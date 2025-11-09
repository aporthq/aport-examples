"""
Simple Microsoft Agent Framework + APort Integration Example

This is a minimal example showing how to use APort middleware with
Microsoft Agent Framework for pre-execution authorization.

Prerequisites:
    pip install agent-framework
    pip install aporthq-sdk-python
    pip install azure-identity

Run: python simple-example.py
"""

import asyncio
import os

# Microsoft Agent Framework imports
try:
    from agent_framework.azure import AzureAIAgentClient
    from azure.identity.aio import AzureCliCredential
except ImportError:
    print("⚠️  Microsoft Agent Framework not installed")
    print("   Install with: pip install agent-framework azure-identity")
    exit(1)

# Import APort middleware
from aport_middleware import aport_agent_middleware


async def process_refund_tool(order_id: str, amount: int) -> str:
    """Process a refund - only called if APort authorization passes."""
    return f"Refund of ${amount/100:.2f} processed for order {order_id}"


async def main():
    """Simple example of APort middleware with Microsoft Agent Framework."""
    print("🛡️ Simple APort + Microsoft Agent Framework Example")
    print("=" * 60)
    
    credential = AzureCliCredential()
    
    # Create agent with APort middleware
    async with AzureAIAgentClient(async_credential=credential).create_agent(
        name="RefundAgent",
        instructions="You are a helpful refund assistant.",
        tools=[process_refund_tool],
        middleware=[aport_agent_middleware],  # ← APort middleware
    ) as agent:
        
        # Run with agent ID and policy context
        result = await agent.run(
            "Process a $50 refund for order 12345",
            metadata={
                "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                "policy_id": "finance.payment.refund.v1",
                "action": "refund",
                "amount": 5000,  # Amount in cents
                "currency": "USD",
                "order_id": "12345",
                "region": "US",
            }
        )
        
        print(f"✅ Result: {result}")


if __name__ == "__main__":
    asyncio.run(main())

