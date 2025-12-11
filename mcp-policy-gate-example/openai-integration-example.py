"""
OpenAI Function Calling with MCP and APort Passport

This example shows how to integrate MCP client with OpenAI's function calling API,
automatically attaching agent passports for authorization.

Prerequisites:
    pip install openai
    pip install aporthq-sdk-python
    pip install mcp  # Optional, for direct MCP integration
"""

import os
import json
import asyncio
from typing import Dict, Any, List, Optional

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    print("⚠️  OpenAI SDK not installed. Install with: pip install openai")

from aporthq_sdk_python import APortClient, APortClientOptions
from client_example import MCPClientWithPassport, PolicyDeniedError


# Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AGENT_ID = os.getenv("APORT_AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c")
APORT_BASE_URL = os.getenv("APORT_BASE_URL", "https://api.aport.io")


class OpenAIWithMCPPassport:
    """
    OpenAI client wrapper that integrates MCP tools with passport support
    """
    
    def __init__(self, agent_id: str, openai_client: Optional[OpenAI] = None):
        self.agent_id = agent_id
        self.openai_client = openai_client or (OpenAI(api_key=OPENAI_API_KEY) if OPENAI_AVAILABLE else None)
        self.mcp_client: Optional[MCPClientWithPassport] = None
        self.aport_client = APortClient(APortClientOptions(base_url=APORT_BASE_URL))
    
    async def initialize_mcp(self):
        """Initialize MCP client connection"""
        self.mcp_client = MCPClientWithPassport(self.agent_id)
        await self.mcp_client.connect()
    
    async def close(self):
        """Close connections"""
        if self.mcp_client:
            await self.mcp_client.close()
        await self.aport_client.close()
    
    def _map_openai_function_to_mcp_tool(self, function_name: str) -> str:
        """
        Map OpenAI function name to MCP tool name
        
        In a real implementation, you would maintain a mapping of
        OpenAI function names to MCP tool names.
        """
        mapping = {
            "process_refund": "process_refund",
            "merge_pull_request": "merge_pull_request",
            "export_customer_data": "export_customer_data",
        }
        return mapping.get(function_name, function_name)
    
    async def handle_function_call(
        self,
        function_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle OpenAI function call by routing to MCP tool with passport
        
        This is called when OpenAI requests a function execution.
        """
        if not self.mcp_client:
            await self.initialize_mcp()
        
        # Map OpenAI function to MCP tool
        mcp_tool_name = self._map_openai_function_to_mcp_tool(function_name)
        
        try:
            # Call MCP tool with passport attached
            result = await self.mcp_client.call_tool(
                mcp_tool_name,
                arguments,
                retry_on_denial=True,
                max_retries=3,
            )
            
            # Format result for OpenAI
            if result.content:
                text_content = next(
                    (c.get("text", "") for c in result.content if c.get("type") == "text"),
                    ""
                )
                return {
                    "role": "function",
                    "name": function_name,
                    "content": text_content,
                }
            
            return {
                "role": "function",
                "name": function_name,
                "content": "Tool executed successfully",
            }
            
        except PolicyDeniedError as error:
            # Return policy denial to OpenAI
            return {
                "role": "function",
                "name": function_name,
                "content": f"Policy denied: {error}",
            }
        except Exception as error:
            return {
                "role": "function",
                "name": function_name,
                "content": f"Error: {error}",
            }
    
    async def chat_completion_with_tools(
        self,
        messages: List[Dict[str, Any]],
        functions: List[Dict[str, Any]],
        model: str = "gpt-4"
    ) -> Dict[str, Any]:
        """
        Chat completion with function calling, routing to MCP tools with passport
        
        This demonstrates the full flow:
        1. OpenAI decides to call a function
        2. We route it to MCP tool with agent_id attached
        3. MCP server verifies passport via APort
        4. Result is returned to OpenAI
        """
        if not self.openai_client:
            raise RuntimeError("OpenAI client not initialized")
        
        if not self.mcp_client:
            await self.initialize_mcp()
        
        # Make initial chat completion request
        response = self.openai_client.chat.completions.create(
            model=model,
            messages=messages,
            functions=functions,
            function_call="auto",
        )
        
        # Process function calls
        messages.append(response.choices[0].message.model_dump())
        
        # If function call was requested, execute it
        if response.choices[0].message.function_call:
            function_call = response.choices[0].message.function_call
            function_name = function_call.name
            arguments = json.loads(function_call.arguments)
            
            # Handle function call via MCP with passport
            function_result = await self.handle_function_call(function_name, arguments)
            messages.append(function_result)
            
            # Get final response
            final_response = self.openai_client.chat.completions.create(
                model=model,
                messages=messages,
            )
            
            return final_response
        
        return response


async def example_openai_refund():
    """Example: Process refund via OpenAI function calling"""
    print("=" * 60)
    print("Example: OpenAI Function Calling with MCP Passport")
    print("=" * 60)
    
    wrapper = OpenAIWithMCPPassport(AGENT_ID)
    
    try:
        # Define functions available to OpenAI
        functions = [
            {
                "name": "process_refund",
                "description": "Process a refund for a customer. Amount must be in cents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "amount": {"type": "integer", "description": "Amount in cents"},
                        "currency": {"type": "string", "description": "Currency code (USD, EUR, etc.)"},
                        "order_id": {"type": "string", "description": "Order ID"},
                        "customer_id": {"type": "string", "description": "Customer ID"},
                        "reason_code": {"type": "string", "description": "Reason for refund"},
                    },
                    "required": ["amount", "currency", "order_id", "customer_id"],
                },
            }
        ]
        
        # User request
        messages = [
            {
                "role": "user",
                "content": "Refund $50 to customer_123 for order ord_456"
            }
        ]
        
        # Chat completion with function calling
        response = await wrapper.chat_completion_with_tools(
            messages=messages,
            functions=functions,
        )
        
        print("✅ OpenAI response:", response.choices[0].message.content)
        
    except Exception as error:
        print(f"❌ Error: {error}")
    finally:
        await wrapper.close()


async def main():
    """Main example"""
    if not OPENAI_AVAILABLE:
        print("⚠️  OpenAI SDK not available. Install with: pip install openai")
        return
    
    if not OPENAI_API_KEY:
        print("⚠️  OPENAI_API_KEY environment variable not set")
        return
    
    await example_openai_refund()


if __name__ == "__main__":
    import json
    asyncio.run(main())

