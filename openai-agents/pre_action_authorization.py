"""
Pre-Action Authorization Pattern for AI Agents

This example demonstrates a framework-agnostic pattern for enforcing authorization
immediately before any effectful tool/API call (refunds, trades, data exports) using APort.

**Key Architecture Decision:**
- APort wraps **tool execution**, NOT the LLM client
- This makes it work with any agent framework (OpenAI, Anthropic, LangChain, etc.)
- GuardrailsOpenAI wraps the LLM client (data safety)
- APort wraps tool execution (action authorization)
- They're complementary, not competitive

The pattern:
1. Agent decides what action to take
2. Before executing the tool, verify authorization with APort
3. If authorized, execute the tool; otherwise, deny with reasons

This complements input/output guardrails (like GuardrailsOpenAI) by adding action-level authorization.
"""

import asyncio
import os
from typing import Any, Callable, Dict, Optional, TypeVar

# Import APort SDK
from aporthq_sdk_python import APortClient, APortClientOptions, PolicyVerificationResponse

# Note: This pattern works with any agent framework, not just OpenAI
# Examples:
# - OpenAI Agents SDK: from openai.agents import Agent, Tool
# - GuardrailsOpenAI: from guardrails import GuardrailsOpenAI, GuardrailTripwireTriggered
# - Regular OpenAI: from openai import OpenAI
# - Anthropic: from anthropic import Anthropic
# - LangChain: from langchain.agents import AgentExecutor
# - Microsoft Agent Framework
# 
# The key: APort wraps functions, not framework-specific clients
# Both GuardrailsOpenAI and regular OpenAI work - GuardrailsOpenAI adds input/output guardrails

T = TypeVar('T')


class AuthorizationError(Exception):
    """Raised when authorization is denied."""
    
    def __init__(self, decision: PolicyVerificationResponse, message: str = "Authorization denied"):
        self.decision = decision
        self.message = message
        super().__init__(self.message)


class PreActionAuthorizer:
    """
    Wrapper for pre-action authorization using APort.
    
    This class provides a generic pattern for authorizing actions before
    they execute, enforcing agent identity, policy limits, and business rules.
    """
    
    def __init__(self, client: APortClient):
        self.client = client
    
    async def verify(
        self,
        agent_id: str,
        policy_id: str,
        context: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> PolicyVerificationResponse:
        """
        Verify authorization for an action.
        
        Args:
            agent_id: The agent passport ID
            policy_id: The policy to verify (e.g., "finance.payment.refund.v1")
            context: Policy-specific context (amount, currency, region, etc.)
            idempotency_key: Optional idempotency key for deduplication
        
        Returns:
            PolicyVerificationResponse with allow, decision_id, reasons, etc.
        
        Raises:
            AuthorizationError: If authorization is denied
        """
        decision = await self.client.verify_policy(
            agent_id=agent_id,
            policy_id=policy_id,
            context=context,
            idempotency_key=idempotency_key,
        )
        
        if not decision.allow:
            raise AuthorizationError(
                decision,
                f"Authorization denied: {decision.reasons or 'Policy check failed'}"
            )
        
        return decision


def with_pre_action_authorization(
    authorizer: PreActionAuthorizer,
    agent_id: str,
    policy_id: str,
    build_context: Callable[..., Dict[str, Any]],
    idempotency_key_fn: Optional[Callable[..., Optional[str]]] = None,
):
    """
    Decorator/wrapper for adding pre-action authorization to tool functions.
    
    Usage:
        @with_pre_action_authorization(
            authorizer=authorizer,
            agent_id="ap_my_agent",
            policy_id="finance.payment.refund.v1",
            build_context=lambda amount, currency, **kwargs: {
                "amount": amount,
                "currency": currency,
                **kwargs
            }
        )
        async def execute_refund(amount: int, currency: str, customer_id: str):
            # Tool implementation
            return {"status": "success", "refund_id": "ref_123"}
    
    Args:
        authorizer: PreActionAuthorizer instance
        agent_id: Agent passport ID
        policy_id: Policy to verify
        build_context: Function to build context from tool arguments
        idempotency_key_fn: Optional function to generate idempotency key
    
    Returns:
        Wrapped function that verifies authorization before execution
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        async def wrapper(*args, **kwargs) -> T:
            # Build context from function arguments
            context = build_context(*args, **kwargs)
            
            # Generate idempotency key if provided
            idempotency_key = None
            if idempotency_key_fn:
                idempotency_key = idempotency_key_fn(*args, **kwargs)
            
            # Verify authorization
            try:
                decision = await authorizer.verify(
                    agent_id=agent_id,
                    policy_id=policy_id,
                    context=context,
                    idempotency_key=idempotency_key,
                )
                
                # Log decision for audit trail
                print(f"✅ Authorization allowed: decision_id={decision.decision_id}")
                
                # Execute the tool
                return await func(*args, **kwargs) if asyncio.iscoroutinefunction(func) else func(*args, **kwargs)
                
            except AuthorizationError as e:
                # Log denial for audit trail
                print(f"❌ Authorization denied: decision_id={e.decision.decision_id}")
                print(f"   Reasons: {e.decision.reasons}")
                
                # Re-raise with decision context
                raise AuthorizationError(
                    e.decision,
                    f"Action denied: {', '.join([r.get('message', '') for r in (e.decision.reasons or [])])}"
                )
        
        return wrapper
    return decorator


# Example: Refund tool with pre-action authorization
async def execute_refund(
    amount: int,
    currency: str,
    customer_id: str,
    reason: str = "Customer request",
) -> Dict[str, Any]:
    """
    Execute a refund (example tool implementation).
    
    This would normally call your payment processor API.
    """
    # Simulate API call
    await asyncio.sleep(0.1)
    
    return {
        "status": "success",
        "refund_id": f"ref_{customer_id}_{amount}",
        "amount": amount,
        "currency": currency,
        "customer_id": customer_id,
        "reason": reason,
    }


# Example: Data export tool with pre-action authorization
async def execute_data_export(
    table_name: str,
    row_limit: int,
    include_pii: bool = False,
) -> Dict[str, Any]:
    """
    Execute a data export (example tool implementation).
    
    This would normally call your database export API.
    """
    # Simulate API call
    await asyncio.sleep(0.1)
    
    return {
        "status": "success",
        "export_id": f"exp_{table_name}",
        "table_name": table_name,
        "rows_exported": min(row_limit, 1000),  # Simulated
        "include_pii": include_pii,
    }


async def main():
    """
    Example usage of pre-action authorization with OpenAI Agents SDK.
    """
    print("🚀 Pre-Action Authorization Example for OpenAI Agents SDK\n")
    
    # Initialize APort client
    client = APortClient(
        APortClientOptions(
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
            api_key=os.getenv("APORT_API_KEY"),  # Optional for public endpoints
        )
    )
    
    authorizer = PreActionAuthorizer(client)
    
    # Example 1: Refund with authorization
    print("=" * 60)
    print("Example 1: Refund with Pre-Action Authorization")
    print("=" * 60)
    
    # Wrap the refund tool with authorization
    authorized_refund = with_pre_action_authorization(
        authorizer=authorizer,
        agent_id=os.getenv("AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c"),
        policy_id="finance.payment.refund.v1",
        build_context=lambda amount, currency, customer_id, **kwargs: {
            "amount": amount,
            "currency": currency,
            "customer_id": customer_id,
            "reason": kwargs.get("reason", "Customer request"),
        },
    )(execute_refund)
    
    try:
        # This will verify authorization before executing
        result = await authorized_refund(
            amount=5000,  # $50.00 in cents
            currency="USD",
            customer_id="cust_123",
            reason="Customer requested refund",
        )
        print(f"✅ Refund executed: {result}")
    except AuthorizationError as e:
        print(f"❌ Refund denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")
        print(f"   Reasons: {e.decision.reasons}")
    
    # Example 2: Data export with authorization
    print("\n" + "=" * 60)
    print("Example 2: Data Export with Pre-Action Authorization")
    print("=" * 60)
    
    authorized_export = with_pre_action_authorization(
        authorizer=authorizer,
        agent_id=os.getenv("AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c"),
        policy_id="data.export.create.v1",
        build_context=lambda table_name, row_limit, include_pii, **kwargs: {
            "table_name": table_name,
            "row_limit": row_limit,
            "include_pii": include_pii,
        },
    )(execute_data_export)
    
    try:
        # This will verify authorization before executing
        result = await authorized_export(
            table_name="users",
            row_limit=1000,
            include_pii=False,
        )
        print(f"✅ Export executed: {result}")
    except AuthorizationError as e:
        print(f"❌ Export denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")
        print(f"   Reasons: {e.decision.reasons}")
    
    # Example 3: Direct authorization check (without wrapper)
    print("\n" + "=" * 60)
    print("Example 3: Direct Authorization Check")
    print("=" * 60)
    
    try:
        decision = await authorizer.verify(
            agent_id=os.getenv("AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c"),
            policy_id="finance.payment.refund.v1",
            context={
                "amount": 10000,  # $100.00 in cents
                "currency": "USD",
                "customer_id": "cust_456",
            },
        )
        print(f"✅ Authorization allowed: decision_id={decision.decision_id}")
        print(f"   Assurance level: {decision.assurance_level}")
        
        # Now safe to execute the tool
        result = await execute_refund(
            amount=10000,
            currency="USD",
            customer_id="cust_456",
        )
        print(f"✅ Refund executed: {result}")
        
    except AuthorizationError as e:
        print(f"❌ Authorization denied: {e.message}")
        print(f"   Decision ID: {e.decision.decision_id}")
    
    # Cleanup
    await client.close()
    
    print("\n✨ Example completed!")


if __name__ == "__main__":
    asyncio.run(main())

