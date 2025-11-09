"""
Complete Microsoft Agent Framework + APort Integration Example

This example demonstrates a production-ready integration of APort with
Microsoft Agent Framework using middleware for pre-execution authorization.

Features:
1. Agent Run Middleware - Verifies authorization before agent execution
2. Function Calling Middleware - Authorizes individual tool/function calls
3. Proper error handling with framework-compliant responses
4. Audit trail generation
5. Both function-based and class-based middleware examples

Prerequisites:
    pip install agent-framework
    pip install aporthq-sdk-python
    pip install azure-identity  # For Azure authentication

Run: python complete-example.py
"""

import asyncio
import os
import logging
from typing import Dict, Any

# Microsoft Agent Framework imports
# Note: Adjust imports based on actual SDK structure
try:
    from agent_framework.azure import AzureAIAgentClient
    from azure.identity.aio import AzureCliCredential
    from agent_framework import AgentRunContext
except ImportError:
    print("⚠️  Microsoft Agent Framework not installed")
    print("   Install with: pip install agent-framework azure-identity")
    print("   This example will show the pattern but won't run without the SDK")
    # Type stubs for documentation
    class AzureAIAgentClient:
        pass
    class AzureCliCredential:
        pass

# Import APort middleware
from aport_middleware import (
    aport_agent_middleware,
    aport_function_middleware,
    AportAgentMiddleware,
    AportFunctionMiddleware,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# ============================================================================
# Example Tool Functions
# ============================================================================

async def process_refund_tool(order_id: str, amount: int, currency: str = "USD") -> Dict[str, Any]:
    """
    Process a refund - only called if APort authorization passes.
    
    This function will be wrapped by function calling middleware,
    which verifies authorization before execution.
    """
    logger.info(f"Processing refund: ${amount/100:.2f} {currency} for order {order_id}")
    
    # Simulate API call
    await asyncio.sleep(0.1)
    
    return {
        "status": "success",
        "refund_id": f"ref_{order_id}_{amount}",
        "amount": amount,
        "currency": currency,
        "order_id": order_id,
    }


async def export_data_tool(table_name: str, row_limit: int, include_pii: bool = False) -> Dict[str, Any]:
    """
    Export data - only called if APort authorization passes.
    """
    logger.info(f"Exporting data: {table_name}, limit={row_limit}, pii={include_pii}")
    
    await asyncio.sleep(0.1)
    
    return {
        "status": "success",
        "export_id": f"exp_{table_name}",
        "table_name": table_name,
        "rows_exported": min(row_limit, 1000),
        "include_pii": include_pii,
    }


# ============================================================================
# Example 1: Function-Based Middleware
# ============================================================================

async def example_function_based_middleware():
    """
    Example using function-based middleware (simplest approach).
    """
    logger.info("=" * 60)
    logger.info("Example 1: Function-Based Middleware")
    logger.info("=" * 60)
    
    try:
        credential = AzureCliCredential()
        
        # Create agent with APort middleware
        async with AzureAIAgentClient(async_credential=credential).create_agent(
            name="RefundAgent",
            instructions=(
                "You are a customer support agent that can process refunds. "
                "When a customer requests a refund, use the refund tool to process it. "
                "Always confirm the amount and currency before processing."
            ),
            tools=[process_refund_tool, export_data_tool],
            middleware=[
                aport_agent_middleware,  # Agent-level middleware
                aport_function_middleware,  # Function-level middleware
            ],
        ) as agent:
            
            # Example 1: Authorized refund
            logger.info("\n📝 Test 1: Authorized refund ($50)")
            logger.info("-" * 60)
            
            result = await agent.run(
                "Process a $50 refund for order 12345",
                metadata={
                    "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                    "policy_id": "finance.payment.refund.v1",
                    "action": "refund",
                    "amount": 5000,  # $50.00 in cents
                    "currency": "USD",
                    "order_id": "12345",
                    "region": "US",
                }
            )
            
            logger.info(f"✅ Result: {result}")
            
            # Example 2: Large refund (might exceed limits)
            logger.info("\n📝 Test 2: Large refund ($10,000)")
            logger.info("-" * 60)
            
            result = await agent.run(
                "Process a $10,000 refund for order 67890",
                metadata={
                    "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                    "policy_id": "finance.payment.refund.v1",
                    "action": "refund",
                    "amount": 1000000,  # $10,000.00 in cents
                    "currency": "USD",
                    "order_id": "67890",
                    "region": "US",
                }
            )
            
            logger.info(f"Result: {result}")
            logger.info("(This may be denied if amount exceeds policy limits)")
            
    except Exception as e:
        logger.error(f"Error in function-based middleware example: {e}", exc_info=True)


# ============================================================================
# Example 2: Class-Based Middleware
# ============================================================================

async def example_class_based_middleware():
    """
    Example using class-based middleware (for stateful operations).
    """
    logger.info("\n" + "=" * 60)
    logger.info("Example 2: Class-Based Middleware")
    logger.info("=" * 60)
    
    try:
        credential = AzureCliCredential()
        
        # Create middleware instances
        agent_middleware = AportAgentMiddleware(
            api_key=os.getenv("APORT_API_KEY"),
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
            timeout_ms=800,
        )
        
        function_middleware = AportFunctionMiddleware(
            api_key=os.getenv("APORT_API_KEY"),
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
            policy_mapping={
                "process_refund": "finance.payment.refund.v1",
                "export_data": "data.export.create.v1",
            },
        )
        
        # Create agent with class-based middleware
        async with AzureAIAgentClient(async_credential=credential).create_agent(
            name="DataAgent",
            instructions=(
                "You are a data export assistant. "
                "When users request data exports, use the export_data tool."
            ),
            tools=[export_data_tool],
            middleware=[
                agent_middleware.process,  # Use process method
                function_middleware.process,  # Function middleware
            ],
        ) as agent:
            
            result = await agent.run(
                "Export 1000 rows from the users table",
                metadata={
                    "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                    "policy_id": "data.export.create.v1",
                    "action": "export",
                    "table_name": "users",
                    "row_limit": 1000,
                    "include_pii": False,
                }
            )
            
            logger.info(f"✅ Result: {result}")
            
    except Exception as e:
        logger.error(f"Error in class-based middleware example: {e}", exc_info=True)


# ============================================================================
# Example 3: Agent-Level vs Run-Level Middleware
# ============================================================================

async def example_agent_vs_run_level():
    """
    Example showing agent-level vs run-level middleware.
    """
    logger.info("\n" + "=" * 60)
    logger.info("Example 3: Agent-Level vs Run-Level Middleware")
    logger.info("=" * 60)
    
    try:
        credential = AzureCliCredential()
        
        # Agent-level middleware: Applied to ALL runs
        async with AzureAIAgentClient(async_credential=credential).create_agent(
            name="FlexibleAgent",
            instructions="You are a helpful assistant.",
            tools=[process_refund_tool],
            middleware=[
                aport_agent_middleware,  # Agent-level: applies to all runs
            ],
        ) as agent:
            
            # Run 1: Uses agent-level middleware only
            logger.info("\n📝 Run 1: Agent-level middleware only")
            result1 = await agent.run(
                "What's the weather?",
                metadata={
                    "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                    # No policy_id - just passport verification
                }
            )
            logger.info(f"Result: {result1}")
            
            # Run 2: Agent-level + run-level middleware
            logger.info("\n📝 Run 2: Agent-level + run-level middleware")
            
            # Define run-level middleware (e.g., additional logging)
            async def run_level_logging_middleware(context, next):
                logger.info("Run-level middleware: Before execution")
                await next(context)
                logger.info("Run-level middleware: After execution")
            
            result2 = await agent.run(
                "Process a $25 refund for order 11111",
                middleware=[run_level_logging_middleware],  # Run-level only
                metadata={
                    "agent_id": os.getenv("APORT_AGENT_ID", "ap_demo_agent"),
                    "policy_id": "finance.payment.refund.v1",
                    "action": "refund",
                    "amount": 2500,
                    "currency": "USD",
                }
            )
            logger.info(f"Result: {result2}")
            
    except Exception as e:
        logger.error(f"Error in agent vs run-level example: {e}", exc_info=True)


# ============================================================================
# Main
# ============================================================================

async def main():
    """
    Run all examples.
    """
    logger.info("🛡️ Microsoft Agent Framework + APort Integration Examples")
    logger.info("=" * 60)
    logger.info("\nThis example demonstrates:")
    logger.info("1. Function-based middleware (simplest)")
    logger.info("2. Class-based middleware (stateful)")
    logger.info("3. Agent-level vs run-level middleware")
    logger.info("4. Proper error handling and audit trails")
    logger.info("\nSecurity Flow:")
    logger.info("  User Request")
    logger.info("    ↓")
    logger.info("  APort Agent Middleware (pre-execution authorization)")
    logger.info("    ↓")
    logger.info("  Agent Execution")
    logger.info("    ↓")
    logger.info("  APort Function Middleware (tool-level authorization)")
    logger.info("    ↓")
    logger.info("  Tool Execution (if authorized)")
    logger.info("    ↓")
    logger.info("  Audit Trail Generation")
    logger.info()
    
    # Check if Microsoft Agent Framework is available
    try:
        from agent_framework.azure import AzureAIAgentClient
    except ImportError:
        logger.warning("⚠️  Microsoft Agent Framework not installed")
        logger.warning("   Install with: pip install agent-framework azure-identity")
        logger.warning("   This example shows the pattern but requires the SDK to run")
        return
    
    # Run examples
    try:
        await example_function_based_middleware()
        await example_class_based_middleware()
        await example_agent_vs_run_level()
        
        logger.info("\n" + "=" * 60)
        logger.info("✨ Examples completed!")
        logger.info("\nKey Takeaways:")
        logger.info("- Function-based middleware: Simplest, stateless")
        logger.info("- Class-based middleware: Stateful, reusable")
        logger.info("- Agent-level: Applies to all runs")
        logger.info("- Run-level: Per-request customization")
        logger.info("- APort integrates seamlessly with Microsoft Agent Framework")
        logger.info("- Fail-closed by default with audit trails")
        
    except Exception as e:
        logger.error(f"Error running examples: {e}", exc_info=True)


if __name__ == "__main__":
    asyncio.run(main())

