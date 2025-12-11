"""
MCP Client with Passport Example

This example demonstrates how to attach agent passports to MCP tool calls
for authorization verification. This is the CLIENT side - the agent that
makes tool calls to MCP servers.

Key concepts:
1. Attach agent_id to MCP tool call arguments
2. Handle policy denials gracefully (retry with lower request, or escalate)
3. Passport renewal flow when passport expires
4. Error handling and audit trails

This works with any MCP server that requires agent_id for policy verification.
"""

import asyncio
import os
import json
import time
from typing import Any, Dict, Optional, List
# MCP SDK imports (install: pip install mcp)
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    print("⚠️  MCP SDK not installed. Install with: pip install mcp")
    print("   For now, this example shows the pattern without actual MCP calls")
    ClientSession = None
    stdio_client = None

# APort SDK imports
try:
    from aporthq_sdk_python import APortClient, APortClientOptions
except ImportError:
    print("⚠️  APort SDK not installed. Install with: pip install aporthq-sdk-python")
    APortClient = None
    APortClientOptions = None


# Configuration
AGENT_ID = os.getenv("APORT_AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c")
APORT_BASE_URL = os.getenv("APORT_BASE_URL", "https://api.aport.io")
MCP_SERVER_COMMAND = os.getenv("MCP_SERVER_COMMAND", "npx")
MCP_SERVER_ARGS = os.getenv("MCP_SERVER_ARGS", "@aporthq/mcp-policy-gate-example").split()


class PolicyDeniedError(Exception):
    """Raised when a policy denies a tool call"""
    def __init__(self, message: str, result: Any = None):
        super().__init__(message)
        self.result = result


class MCPClientWithPassport:
    """
    MCP Client with Passport Support
    
    Wraps the MCP client to automatically attach agent_id to tool calls
    """
    
    def __init__(self, agent_id: str, server_params: Optional[StdioServerParameters] = None):
        self.agent_id = agent_id
        self.server_params = server_params
        self.session: Optional[ClientSession] = None
        
        # Initialize APort client
        if APortClient:
            self.aport_client = APortClient(APortClientOptions(
                base_url=APORT_BASE_URL,
                timeout_ms=5000,
            ))
        else:
            self.aport_client = None
    
    async def __aenter__(self):
        """Async context manager entry"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.close()
    
    async def connect(self):
        """Connect to MCP server"""
        if not stdio_client:
            raise ImportError("MCP SDK not installed. Install with: pip install mcp")
        
        if not self.server_params:
            # Default server params
            self.server_params = StdioServerParameters(
                command=MCP_SERVER_COMMAND,
                args=MCP_SERVER_ARGS,
            )
        
        # Connect to MCP server
        async with stdio_client(self.server_params) as (read, write):
            async with ClientSession(read, write) as session:
                self.session = session
                print(f"[MCP Client] Connected to MCP server with agent_id: {self.agent_id}")
    
    def _get_policy_id_for_tool(self, tool_name: str) -> str:
        """Map MCP tool name to APort policy ID"""
        tool_to_policy_map = {
            "merge_pull_request": "code.repository.merge.v1",
            "process_refund": "finance.payment.refund.v1",
            "export_customer_data": "data.export.create.v1",
            "publish_release": "code.release.publish.v1",
            "send_message": "messaging.message.send.v1",
            "execute_transaction": "finance.transaction.execute.v1",
            "access_data": "governance.data.access.v1",
            "crypto_trade": "finance.crypto.trade.v1",
            "ingest_report": "data.report.ingest.v1",
            "review_contract": "legal.contract.review.v1",
        }
        
        policy_id = tool_to_policy_map.get(tool_name)
        if not policy_id:
            available = ", ".join(tool_to_policy_map.keys())
            raise ValueError(
                f"No policy mapping found for tool: {tool_name}. "
                f"Available tools: {available}"
            )
        return policy_id
    
    def _build_policy_context(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Build context for policy verification from tool arguments"""
        context: Dict[str, Any] = {
            "agent_id": self.agent_id,
            **args,
        }
        
        # Add tool-specific context transformations
        if tool_name == "merge_pull_request":
            context["base_branch"] = args.get("base_branch", "main")
            context["pr_size_kb"] = args.get("pr_size_kb", 250)
        elif tool_name == "process_refund":
            context["reason_code"] = args.get("reason_code", "customer_request")
        
        return context
    
    async def call_tool(
        self,
        tool_name: str,
        args: Dict[str, Any],
        retry_on_denial: bool = False,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        skip_verification: bool = False,  # For testing or when server handles verification
    ) -> Any:
        """
        Call MCP tool with automatic policy verification and agent_id attachment
        
        Args:
            tool_name: Name of the tool to call
            args: Tool arguments (agent_id will be added automatically)
            retry_on_denial: Whether to retry with adjusted parameters on denial
            max_retries: Maximum number of retry attempts
            retry_backoff: Backoff delay in seconds between retries
            skip_verification: Skip client-side verification (server handles it)
        """
        if not self.aport_client:
            raise RuntimeError("APort client not initialized")
        
        last_error: Optional[Exception] = None
        current_args = args.copy()
        
        for attempt in range(max_retries):
            try:
                # Step 1: Verify policy BEFORE calling MCP tool (unless skipped)
                if not skip_verification:
                    policy_id = self._get_policy_id_for_tool(tool_name)
                    context = self._build_policy_context(tool_name, current_args)
                    
                    print(
                        f"[Policy Verification] Verifying {policy_id} for agent {self.agent_id} "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    
                    decision = await self.aport_client.verify_policy(
                        self.agent_id,
                        policy_id,
                        context,
                    )
                    
                    print(
                        f"[Policy Decision] {decision.decision_id}: "
                        f"{'ALLOW' if decision.allow else 'DENY'}"
                    )
                    
                    if not decision.allow:
                        reasons = (
                            ", ".join(r.message for r in decision.reasons)
                            if decision.reasons
                            else "Policy denied"
                        )
                        raise PolicyDeniedError(f"Policy denied: {reasons}", decision)
                    
                    print(
                        f"[Policy Verification] ✅ Policy check passed "
                        f"(decision_id: {decision.decision_id})"
                    )
                
                # Step 2: Call MCP tool with agent_id attached
                print(f"[Tool Call] Calling {tool_name} (attempt {attempt + 1}/{max_retries})")
                
                if not self.session:
                    raise RuntimeError("Not connected to MCP server")
                
                # Attach agent_id to arguments for MCP server
                args_with_passport = {
                    **current_args,
                    "agent_id": self.agent_id,
                }
                
                # Call tool via MCP
                result = await self.session.call_tool(tool_name, args_with_passport)
                
                # Check if result indicates policy denial (server-side check)
                if result.content:
                    for content in result.content:
                        if isinstance(content, dict) and content.get("type") == "text":
                            text = content.get("text", "")
                            if "Policy denied" in text:
                                raise PolicyDeniedError(text, result)
                
                print(f"[Tool Call] ✅ {tool_name} succeeded")
                return result
                
            except PolicyDeniedError as error:
                last_error = error
                
                # If retry is enabled, try with adjusted parameters
                if retry_on_denial and attempt < max_retries - 1:
                    print(f"[Tool Call] ❌ Policy denied, retrying with adjusted parameters...")
                    
                    # Example: Reduce amount for refunds, reduce row limit for exports
                    if tool_name == "process_refund" and "amount" in current_args:
                        current_args["amount"] = int(current_args["amount"] * 0.5)  # Reduce by 50%
                        print(f"[Tool Call] Retrying with reduced amount: {current_args['amount']}")
                    elif tool_name == "export_customer_data" and "limit" in current_args:
                        current_args["limit"] = int(current_args["limit"] * 0.5)  # Reduce by 50%
                        print(f"[Tool Call] Retrying with reduced limit: {current_args['limit']}")
                    
                    # Wait before retry
                    await asyncio.sleep(retry_backoff * (attempt + 1))
                    continue
                
                # If not retryable or max retries reached, raise
                raise
                
            except Exception as error:
                last_error = error
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_backoff * (attempt + 1))
                    continue
                raise
        
        raise last_error or Exception(f"Failed to call {tool_name} after {max_retries} attempts")
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools from MCP server"""
        if not self.session:
            raise RuntimeError("Not connected to MCP server")
        
        result = await self.session.list_tools()
        return result.tools or []
    
    async def close(self):
        """Close connection"""
        if self.session:
            # Session is closed automatically by context manager
            pass
        if self.aport_client:
            await self.aport_client.close()


async def example_with_openai():
    """
    Example: Using MCP Client with OpenAI Function Calling
    
    This shows how to integrate MCP client with OpenAI's function calling API
    """
    print("=" * 60)
    print("Example: MCP Client with OpenAI Function Calling")
    print("=" * 60)
    
    # In a real OpenAI integration, you would:
    # 1. Get function call from OpenAI
    # 2. Map function name to MCP tool name
    # 3. Call MCP tool with agent_id attached
    # 4. Return result to OpenAI
    
    async with MCPClientWithPassport(AGENT_ID) as mcp_client:
        try:
            # Simulate OpenAI function call: "refund $50 to customer_123"
            openai_function_call = {
                "name": "process_refund",
                "arguments": {
                    "amount": 5000,  # $50.00 in cents
                    "currency": "USD",
                    "order_id": "ord_123",
                    "customer_id": "customer_123",
                    "reason_code": "customer_request",
                },
            }
            
            # Call MCP tool with passport attached
            result = await mcp_client.call_tool(
                openai_function_call["name"],
                openai_function_call["arguments"],
                retry_on_denial=True,
                max_retries=3,
            )
            
            print("✅ Refund processed:", result)
            
        except PolicyDeniedError as error:
            print(f"❌ Policy denied: {error}")
            print(f"   Result: {error.result}")
            # In a real OpenAI integration, you would return this to the user
        except Exception as error:
            print(f"❌ Error: {error}")


async def example_with_anthropic():
    """
    Example: Using MCP Client with Anthropic Tool Use
    
    This shows how to integrate MCP client with Anthropic's tool use API
    """
    print("=" * 60)
    print("Example: MCP Client with Anthropic Tool Use")
    print("=" * 60)
    
    async with MCPClientWithPassport(AGENT_ID) as mcp_client:
        try:
            # Simulate Anthropic tool use: "merge PR #123"
            anthropic_tool_use = {
                "id": "toolu_abc123",
                "name": "merge_pull_request",
                "input": {
                    "repository": "my-org/my-repo",
                    "pr_number": 123,
                    "base_branch": "main",
                },
            }
            
            # Call MCP tool with passport attached
            result = await mcp_client.call_tool(
                anthropic_tool_use["name"],
                anthropic_tool_use["input"],
                retry_on_denial=False,  # Don't retry merges
            )
            
            print("✅ PR merged:", result)
            
        except PolicyDeniedError as error:
            print(f"❌ Policy denied: {error}")
            # In a real Anthropic integration, you would return this to the model
        except Exception as error:
            print(f"❌ Error: {error}")


async def example_policy_verification():
    """
    Example: Policy Verification Flow
    
    Demonstrates how policy verification works before tool execution
    """
    print("=" * 60)
    print("Example: Policy Verification Flow")
    print("=" * 60)
    
    async with MCPClientWithPassport(AGENT_ID) as mcp_client:
        try:
            # First call - policy is verified before tool execution
            print("Call 1: Policy verification before tool execution")
            result1 = await mcp_client.call_tool("merge_pull_request", {
                "repository": "my-org/my-repo",
                "pr_number": 1,
            })
            print(f"✅ First call succeeded: {result1}")
            
            # Second call - policy is verified again (fresh verification each time)
            print("\nCall 2: Policy verification again (fresh check)")
            result2 = await mcp_client.call_tool("merge_pull_request", {
                "repository": "my-org/my-repo",
                "pr_number": 2,
            })
            print(f"✅ Second call succeeded: {result2}")
            
            print("\n✅ Policy verification flow completed")
            print("   Note: Each tool call verifies policy before execution")
            
        except PolicyDeniedError as error:
            print(f"❌ Policy denied: {error}")
            if hasattr(error, 'result') and error.result:
                print(f"   Decision ID: {getattr(error.result, 'decision_id', 'N/A')}")
                print(f"   Reasons: {getattr(error.result, 'reasons', 'N/A')}")
        except Exception as error:
            print(f"❌ Error: {error}")


async def example_error_handling():
    """
    Example: Error Handling and Graceful Degradation
    
    Shows how to handle different error scenarios
    """
    print("=" * 60)
    print("Example: Error Handling")
    print("=" * 60)
    
    async with MCPClientWithPassport(AGENT_ID) as mcp_client:
        # Example 1: Policy denial with retry
        print("\n1. Policy denial with automatic retry:")
        try:
            await mcp_client.call_tool(
                "process_refund",
                {
                    "amount": 1000000,  # $10,000 - might exceed limits
                    "currency": "USD",
                    "order_id": "ord_456",
                },
                retry_on_denial=True,
                max_retries=3,
            )
        except PolicyDeniedError:
            print("   Policy denied after retries - escalate to human")
        except Exception as error:
            print(f"   Error: {error}")
        
        # Example 2: Invalid tool name
        print("\n2. Invalid tool name:")
        try:
            await mcp_client.call_tool("nonexistent_tool", {})
        except Exception as error:
            print(f"   Error: {error}")
        
        # Example 3: Network error
        print("\n3. Network error handling:")
        # In production, you would implement retry logic with exponential backoff
        # and circuit breaker pattern


async def main():
    """Main example runner"""
    print("🚀 MCP Client with Passport Examples\n")
    
    # Run examples
    await example_with_openai()
    print("\n")
    
    await example_with_anthropic()
    print("\n")
    
    await example_policy_verification()
    print("\n")
    
    await example_error_handling()
    print("\n")
    
    print("✨ All examples completed!")


if __name__ == "__main__":
    asyncio.run(main())

